import { randomBytes } from 'node:crypto';

import {
  HathorWallet as LibWallet,
  Network,
  SendTransaction,
  helpersUtils,
  scriptsUtils,
  transactionUtils,
} from '@hathor/wallet-lib';

import type { DecodedTx, TxInput, TxOutput } from '../../domain/types';
import type {
  HathorWalletPort,
  HistoryEntry,
  MeltProposalRequest,
  MintProposalRequest,
  TransferProposalRequest,
  WalletStatus,
} from '../../ports/HathorWalletPort';
import { WalletOperationError } from '../../ports/HathorWalletPort';
import type { LoggerPort } from '../../ports/LoggerPort';
import { defaultLibWalletDriver } from './walletLib/defaultDriver';
import { mapHistoryTx } from './walletLib/mapping';
import { SendTxLock } from './walletLib/sendTxLock';

/**
 * Drives @hathor/wallet-lib in process, replacing the headless wallet container entirely.
 *
 * Three facts about the library shape everything here, all of them established by reading its
 * source rather than its docs:
 *
 *  - Sync is address-based, never block-based. There is no "read one block and advance"; the
 *    library walks address history under a scan policy.
 *  - The only storage implementation shipped is MemoryStore. History is therefore rebuilt on every
 *    process start, which is why the wallet has to live in a long-lived process and why nothing
 *    here may restart it casually.
 *  - preCalculatedAddresses silently truncates the sync. Tested against production's multisig, the
 *    wallet reported READY with 520 of 690 transactions and a balance HIGHER than reality, because
 *    injecting addresses raises lastLoadedAddressIndex past what the gap-limit check then walks.
 *    A federator on that state would spend already-spent UTXOs. It is never set here.
 */

const READY_POLL_INTERVAL_MS = 1_000;

/**
 * The library's script parser and the fullnode name the same script differently: `parseScript`
 * reports `p2sh` where the fullnode - and therefore transaction history - reports `MultiSig`.
 *
 * Everything above the port speaks the fullnode's vocabulary; `readBridgedToken` filters on
 * `MultiSig` specifically. Left untranslated, this adapter would contradict itself - history
 * saying `MultiSig` and decode saying `p2sh` for the very same output - and the bridge would find
 * no funds in a decoded proposal. Caught by comparing the two adapters against one testnet wallet.
 */
const SCRIPT_TYPE_TO_FULLNODE: Record<string, string> = {
  p2sh: 'MultiSig',
  p2pkh: 'P2PKH',
};

function normaliseScriptType(type: string | undefined): string | undefined {
  if (type === undefined) {
    return undefined;
  }
  return SCRIPT_TYPE_TO_FULLNODE[type.toLowerCase()] ?? type;
}

export interface WalletLibAdapterConfig {
  readonly seed: string;
  readonly multisig: {
    readonly pubkeys: readonly string[];
    readonly numSignatures: number;
  };
  readonly network: 'mainnet' | 'testnet' | 'privatenet';
  readonly fullnodeUrl: string;
  readonly txMiningUrl: string;
  readonly gapLimit: number;
  /** How long to wait for the initial sync before giving up. */
  readonly startTimeoutMs?: number;
  /** Filled in by the adapter, not by the caller - see the pin/password fields on the class. */
  readonly pin?: string;
  readonly password?: string;
}

/**
 * The two places this adapter reaches the library in ways that need a network: building the wallet
 * and broadcasting a transaction.
 *
 * Named and injectable so everything in between - decoding, proposal assembly, the input lock, the
 * send lock - is testable offline, while the default remains the real path. Mocking the library
 * module instead would leave the tests asserting against the mock.
 */
export interface LibWalletDriver {
  create(config: WalletLibAdapterConfig, logger: LoggerPort): { wallet: LibWallet; network: Network };
  /** Broadcasts an assembled transaction, returning it once it has been pushed. */
  push(wallet: LibWallet, transaction: unknown, pin: string): Promise<{ hash?: string | null }>;
  /** The height of the best block, as the fullnode reports it. */
  bestBlockHeight(): Promise<number>;
}

/** The library's own wallet states, which this adapter narrows to the port's vocabulary. */
const LIB_STATE: Record<number, WalletStatus['state']> = {
  0: 'closed',
  1: 'connecting',
  2: 'syncing',
  3: 'ready',
  4: 'error',
  5: 'processing',
};

export class WalletLibAdapter implements HathorWalletPort {
  private readonly config: WalletLibAdapterConfig;
  private readonly logger: LoggerPort;
  private readonly sendLock = new SendTxLock();

  /**
   * The seed is encrypted in storage under these, and storage is MemoryStore - it never outlives
   * the process. So they are generated per process rather than configured: there is nothing for an
   * operator to set, and therefore nothing to leak or to get wrong.
   */
  private readonly pin = randomBytes(16).toString('hex');
  private readonly password = randomBytes(16).toString('hex');

  private wallet?: LibWallet;
  private network?: Network;
  private readonly pendingHandlers: Array<(tx: HistoryEntry) => void | Promise<void>> = [];

  private readonly driver: LibWalletDriver;

  constructor(config: WalletLibAdapterConfig, logger: LoggerPort, driver: LibWalletDriver = defaultLibWalletDriver) {
    this.config = config;
    this.logger = logger;
    this.driver = driver;
  }

  private require(): LibWallet {
    return this.requireStarted().wallet;
  }

  /**
   * The wallet and its network together. They are only ever assigned together, so asking for them
   * separately would mean two guards where one is enough - and the second would be a branch no
   * test could reach.
   */
  private requireStarted(): { wallet: LibWallet; network: Network } {
    if (!this.wallet || !this.network) {
      throw new WalletOperationError('Wallet has not been started.');
    }
    return { wallet: this.wallet, network: this.network };
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.wallet && (await this.status()).state === 'ready') {
      return;
    }

    const built = this.driver.create({ ...this.config, pin: this.pin, password: this.password }, this.logger);
    this.wallet = built.wallet;
    this.network = built.network;

    for (const handler of this.pendingHandlers) {
      this.subscribe(handler);
    }

    await this.wallet.start();
    await this.waitUntilReady();
  }

  private async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + (this.config.startTimeoutMs ?? 600_000);

    for (;;) {
      const { state, raw } = await this.status();
      if (state === 'ready') {
        return;
      }
      if (state === 'error') {
        throw new WalletOperationError(`Wallet entered the error state while starting (${String(raw)}).`);
      }
      if (Date.now() >= deadline) {
        throw new WalletOperationError(
          `Wallet was still ${state} after ${this.config.startTimeoutMs ?? 600_000}ms. Sync rebuilds the ` +
            `whole history on every start, so a cold start on a large wallet legitimately takes minutes.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
  }

  async status(): Promise<WalletStatus> {
    if (!this.wallet) {
      return { state: 'closed', raw: 'not started' };
    }
    const state = LIB_STATE[this.wallet.state as unknown as number];
    return { state: state ?? 'unknown', raw: this.wallet.state as unknown as number };
  }

  async stop(): Promise<void> {
    if (!this.wallet) {
      return;
    }
    const wallet = this.wallet;
    this.wallet = undefined as unknown as LibWallet;
    await wallet.stop({ cleanStorage: true, cleanAddresses: true });
  }

  // ---- addresses -----------------------------------------------------------------------------

  async getAddressAtIndex(index: number): Promise<string> {
    // The library's getAddressAtIndex does not mark the address as used, so it does not advance
    // the wallet's own cursor - which is the property the fixed change address depends on.
    return this.require().getAddressAtIndex(index);
  }

  async isOwnAddress(address: string): Promise<boolean> {
    return this.require().isAddressMine(address);
  }

  // ---- reading -------------------------------------------------------------------------------

  /**
   * Full transaction history, newest first.
   *
   * Read straight off the wallet's storage rather than through `getTxHistory()`, which truncates
   * twice and silently: it defaults to `count: 15`, and it filters by `token_id`, defaulting to
   * HTR - so a bridge that cares about custom tokens would have seen a handful of the wrong
   * transactions. Running the two adapters side by side against the same testnet wallet is what
   * exposed it: the headless reported 81 transactions where this returned 15.
   *
   * `storage.txHistory()` iterates everything, unfiltered and unpaged, and already yields whole
   * transactions - so it also avoids a `getTx()` per row.
   */
  async getHistory(): Promise<HistoryEntry[]> {
    const { wallet } = this.requireStarted();

    const entries: HistoryEntry[] = [];
    for await (const tx of wallet.storage.txHistory()) {
      entries.push(mapHistoryTx(tx));
    }

    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getTransaction(txId: string): Promise<DecodedTx | undefined> {
    const tx = await this.require().getTx(txId);
    if (!tx || tx.is_voided) {
      return undefined;
    }
    return mapHistoryTx(tx);
  }

  /**
   * How many blocks have confirmed a transaction.
   *
   * The headless exposed this as one endpoint; the library does not, so it is the two calls the
   * endpoint itself made: the transaction's own height, and the height of the best block.
   */
  async getConfirmationCount(txId: string): Promise<number> {
    const wallet = this.require();
    const full = (await wallet.getFullTxById(txId)) as { meta?: { height?: number | null } };

    const height = full.meta?.height;
    if (height === undefined || height === null) {
      // Not in a block yet. Zero rather than an error: "not confirmed yet" is the normal answer
      // for a transaction that has only just been pushed, and callers compare against a threshold.
      return 0;
    }

    const bestHeight = await this.driver.bestBlockHeight();
    return Math.max(0, bestHeight - Number(height));
  }

  /**
   * Decodes a serialised proposal into the domain's shape.
   *
   * This is the operation the headless wallet gave away for free and the library does not: the hex
   * carries only input references, so the value, token and script of each spent output have to be
   * fetched from the transactions that created them. It feeds proposal validation, which is the
   * security-critical path, so an input that cannot be resolved is an error rather than a zero.
   */
  async decodeTxHex(txHex: string): Promise<DecodedTx> {
    const { wallet, network } = this.requireStarted();
    const tx = helpersUtils.createTxFromHex(txHex, network);

    const inputs: TxInput[] = [];
    for (const [index, input] of tx.inputs.entries()) {
      const spent = await wallet.getTx(input.hash);
      const spentOutput = spent?.outputs[input.index];

      if (!spentOutput) {
        throw new WalletOperationError(
          `Cannot decode the proposal: input ${index} spends ${input.hash}:${input.index}, which this ` +
            `wallet does not know. Validating a proposal against unknown inputs is not safe.`,
        );
      }

      const address = spentOutput.decoded?.address;
      inputs.push({
        value: spentOutput.value ?? 0n,
        tokenData: spentOutput.token_data ?? 0,
        script: spentOutput.script ?? '',
        token: spentOutput.token ?? '',
        decoded: {
          type: spentOutput.decoded?.type,
          address,
          timelock: spentOutput.decoded?.timelock,
        },
        txId: input.hash,
        index: input.index,
        mine: address === undefined ? undefined : await wallet.isAddressMine(address),
      });
    }

    const outputs: TxOutput[] = [];
    for (const output of tx.outputs) {
      const parsed = this.parseOutputScript(output.script);
      outputs.push({
        value: output.value,
        tokenData: output.tokenData,
        script: output.script.toString('base64'),
        token: tx.tokens[output.getTokenIndex()] ?? '00',
        decoded: parsed,
        spentBy: null,
        mine: parsed.address === undefined ? undefined : await wallet.isAddressMine(parsed.address),
      });
    }

    return { inputs, outputs };
  }

  /** An output script is not always an address script - data outputs are the whole point here. */
  private parseOutputScript(script: Buffer): {
    type?: string | undefined;
    address?: string | undefined;
    timelock?: number | null | undefined;
  } {
    const { network } = this.requireStarted();
    try {
      const parsed = scriptsUtils.parseScript(script, network) as {
        getType?: () => string;
        address?: { base58?: string };
        timelock?: number | null;
      } | null;

      if (!parsed) {
        return {};
      }

      return {
        type: normaliseScriptType(parsed.getType?.()),
        address: parsed.address?.base58,
        timelock: parsed.timelock ?? null,
      };
    } catch {
      // A script that is not an address script (a data output, most importantly) is expected, not
      // exceptional.
      return {};
    }
  }

  // ---- proposals -----------------------------------------------------------------------------

  async createMintProposal(request: MintProposalRequest): Promise<string> {
    return this.sendLock.run(async () => {
      const tx = await this.require().prepareMintTokensData(request.token, request.amount, {
        address: request.receiverAddress,
        changeAddress: request.fixedAddress,
        mintAuthorityAddress: request.fixedAddress,
        // The proposal is signed later, by each federator in turn, and pushed later still.
        signTx: false,
        startMiningTx: false,
        pinCode: this.pin,
      });
      return this.finishProposal(tx, request.markInputsAsUsed, request.inputLockTtlMs);
    });
  }

  async createMeltProposal(request: MeltProposalRequest): Promise<string> {
    return this.sendLock.run(async () => {
      const tx = await this.require().prepareMeltTokensData(request.token, request.amount, {
        // A melt has no external recipient: the HTR deposit, the token change and the melt
        // authority all come back to us, so all three are pinned to the same known address.
        address: request.fixedAddress,
        changeAddress: request.fixedAddress,
        meltAuthorityAddress: request.fixedAddress,
        signTx: false,
        startMiningTx: false,
        pinCode: this.pin,
      });
      return this.finishProposal(tx, request.markInputsAsUsed, request.inputLockTtlMs);
    });
  }

  /**
   * Unlike mint and melt, this path builds the transaction itself rather than asking the wallet
   * for a prepared one: SendTransaction selects UTXOs out of storage. That selection is the one
   * piece of this adapter with no offline test - it needs a storage holding real spendable UTXOs -
   * so it is covered by the live HathorWalletPort contract run instead.
   */
  async createTransferProposal(request: TransferProposalRequest): Promise<string> {
    return this.sendLock.run(async () => {
      const wallet = this.require();

      const send = new SendTransaction({
        storage: wallet.storage,
        outputs: request.outputs.map((output) => ({
          address: output.address,
          value: output.value,
          token: output.token,
        })),
        changeAddress: request.fixedAddress,
        pin: this.pin,
      });

      const data = await send.prepareTxData();
      const tx = transactionUtils.createTransactionFromData(data, this.requireStarted().network);
      return this.finishProposal(tx, request.markInputsAsUsed, request.inputLockTtlMs);
    });
  }

  private async finishProposal(
    tx: { toHex(): string },
    markInputsAsUsed: boolean,
    inputLockTtlMs: number,
  ): Promise<string> {
    const txHex = tx.toHex();
    if (markInputsAsUsed) {
      await this.lockProposalInputs(txHex, inputLockTtlMs);
    }
    return txHex;
  }

  async getMySignatures(txHex: string): Promise<string> {
    return this.require().getAllSignatures(txHex, this.pin);
  }

  /**
   * Assembles the collected signatures onto the proposal and broadcasts it.
   *
   * Two details here are load-bearing and neither is obvious from the API:
   *
   *  - assemblePartialTransaction wants exactly numSignatures entries, each covering every input.
   *    The caller guarantees that; this is where it would fail if it did not.
   *  - prepareToSend must be given the weight constants read from storage. Without them the
   *    library falls back to hardcoded mainnet values and produces the wrong weight off mainnet -
   *    a testnet-only failure that is very easy to miss.
   */
  async signAndPush(txHex: string, signatures: readonly string[]): Promise<string> {
    return this.sendLock.run(async () => {
      const wallet = this.require();

      const tx = await wallet.assemblePartialTransaction(txHex, [...signatures]);
      tx.prepareToSend(transactionUtils.getWeightConstantsFromStorage(wallet.storage));

      const pushed = await this.driver.push(wallet, tx, this.pin);

      const hash = pushed.hash;
      if (!hash) {
        throw new WalletOperationError('The transaction was pushed but came back without a hash.');
      }
      return hash;
    });
  }

  async lockProposalInputs(txHex: string, ttlMs: number): Promise<void> {
    const { wallet, network } = this.requireStarted();
    const tx = helpersUtils.createTxFromHex(txHex, network);
    for (const input of tx.inputs) {
      // ttl is milliseconds - it goes straight into setTimeout.
      await wallet.markUtxoSelected(input.hash, input.index, true, ttlMs);
    }
  }

  // ---- events --------------------------------------------------------------------------------

  onNewTransaction(handler: (tx: HistoryEntry) => void | Promise<void>): void {
    if (!this.wallet) {
      // Registered before start, delivered once the wallet exists. The alternative - throwing -
      // would force every caller to order its wiring around this adapter's lifecycle.
      this.pendingHandlers.push(handler);
      return;
    }
    this.subscribe(handler);
  }

  private subscribe(handler: (tx: HistoryEntry) => void | Promise<void>): void {
    this.require().on('new-tx', (tx: unknown) => {
      void (async () => {
        try {
          await handler(mapHistoryTx(tx as never));
        } catch (error) {
          // An event handler that throws would otherwise reach an EventEmitter with no error
          // listener, which takes the whole process down along with the synced wallet.
          this.logger.error('A new-transaction handler failed.', error);
        }
      })();
    });
  }
}
