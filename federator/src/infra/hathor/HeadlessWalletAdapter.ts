import type { DecodedTx } from '../../domain/types';
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
import type { HttpClient, HttpResponse } from './HttpClient';
import { mapTx } from './headlessMapping';
import type {
  HeadlessAddressIndexResponse,
  HeadlessAddressResponse,
  HeadlessConfirmationResponse,
  HeadlessDecodeResponse,
  HeadlessProposalResponse,
  HeadlessPushResponse,
  HeadlessResponse,
  HeadlessSignaturesResponse,
  HeadlessStatusResponse,
  HeadlessTx,
} from './headlessTypes';

/**
 * Drives the headless wallet over HTTP, satisfying the same port the wallet-lib adapter will.
 *
 * Transitional by design. Its job is to give the migration a baseline: the shared contract suite
 * runs against this and against the library adapter, so their behaviour can be compared instead of
 * assumed. It goes away with the container.
 */

/** The wallet states the headless reports, mirroring WalletState in @hathor/wallet-lib. */
const HEADLESS_STATUS: Record<number, WalletStatus['state']> = {
  0: 'closed',
  1: 'connecting',
  2: 'syncing',
  3: 'ready',
  4: 'error',
  5: 'processing',
};

export interface HeadlessAdapterOptions {
  /** The headless wallet id this adapter drives. */
  readonly walletId: string;
  /** Seed key as configured on the headless side. */
  readonly seedKey: string;
  readonly multisig: boolean;
  /** How many times to poll for readiness before giving up. */
  readonly readinessAttempts?: number;
  /** Base delay between readiness polls; the wait grows linearly with the attempt number. */
  readonly readinessDelayMs?: number;
}

export interface Sleeper {
  (ms: number): Promise<void>;
}

const defaultSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HeadlessWalletAdapter implements HathorWalletPort {
  private readonly http: HttpClient;
  private readonly logger: LoggerPort;
  private readonly options: Required<Pick<HeadlessAdapterOptions, 'readinessAttempts' | 'readinessDelayMs'>> &
    HeadlessAdapterOptions;
  private readonly sleep: Sleeper;
  private readonly addressCache = new Map<number, string>();

  constructor(http: HttpClient, options: HeadlessAdapterOptions, logger: LoggerPort, sleep: Sleeper = defaultSleep) {
    this.http = http;
    this.logger = logger;
    this.options = {
      readinessAttempts: 5,
      readinessDelayMs: 10_000,
      ...options,
    };
    this.sleep = sleep;
  }

  private headers(): Record<string, string> {
    return { 'x-wallet-id': this.options.walletId };
  }

  private assertOk<T extends HeadlessResponse>(response: HttpResponse<T>, operation: string): T {
    if (response.status !== 200 || response.data?.success === false) {
      throw new WalletOperationError(
        `${operation} failed: ${response.status} ${response.statusText ?? ''} ${JSON.stringify(response.data)}`,
        response.data?.error ?? response.data?.message,
      );
    }
    return response.data;
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  async start(): Promise<void> {
    for (let attempt = 1; attempt <= this.options.readinessAttempts; attempt++) {
      const { state, raw } = await this.status();

      if (state === 'ready') {
        return;
      }

      // Transient states on the way to ready. `processing` in particular is easy to miss: the
      // wallet reaches it after downloading history, while it works through what it downloaded.
      // Leaving it unhandled is what used to make the federator hang at boot with no error - the
      // status matched no branch, the check resolved undefined, and main waited forever on an
      // event that only the ready path emits.
      if (state === 'connecting' || state === 'syncing' || state === 'processing') {
        await this.sleep(this.options.readinessDelayMs * attempt);
        continue;
      }

      // Not running: never started, stopped, or errored out. Starting is idempotent, so this is
      // also the recovery path for a wallet that died mid-sync.
      if (state === 'closed' || state === 'error') {
        await this.startWallet();
        await this.sleep(this.options.readinessDelayMs * attempt);
        continue;
      }

      // A state this adapter does not recognise - deliberately NOT treated as `error`, which
      // would restart a wallet that is merely in a state this code has not been taught about.
      // Retrying is the safe reading: it is either transient, or the attempt budget ends it with
      // a real error rather than a silent hang.
      void raw;
      await this.sleep(this.options.readinessDelayMs * attempt);
    }

    throw new WalletOperationError(
      `Wallet ${this.options.walletId} did not become ready after ${this.options.readinessAttempts} attempts.`,
    );
  }

  private async startWallet(): Promise<void> {
    const response = await this.http.send<HeadlessResponse>({
      method: 'POST',
      path: 'start',
      headers: this.headers(),
      body: {
        'wallet-id': this.options.walletId,
        seedKey: this.options.seedKey,
        multisig: this.options.multisig,
      },
    });

    // The port defines start as idempotent, and the headless keeps wallets alive across federator
    // restarts - so "already started" is the outcome the caller wanted, not a failure. Treating it
    // as one made start() throw against any headless that was already running.
    if (response.data?.errorCode === 'WALLET_ALREADY_STARTED') {
      this.logger.debug(`Wallet ${this.options.walletId} was already running.`);
      return;
    }

    this.assertOk(response, 'start');
  }

  async status(): Promise<WalletStatus> {
    const response = await this.http.send<HeadlessStatusResponse>({
      method: 'GET',
      path: 'wallet/status',
      headers: this.headers(),
    });

    const code = response.data?.statusCode;

    if (code === undefined) {
      // A wallet that was never started answers with no statusCode at all - the body is
      // `{"success":false,"message":"Invalid wallet id parameter.","statusMessage":""}`. Reading
      // that as `unknown` makes the readiness loop poll forever without ever starting the wallet,
      // which is precisely what it did until a live run against a fresh headless caught it.
      // `closed` is the state that triggers a start, and starting is idempotent.
      if (response.data?.success === false) {
        return { state: 'closed', raw: response.data?.message ?? 'no statusCode' };
      }
      return { state: 'unknown', raw: 'no statusCode' };
    }

    return {
      state: HEADLESS_STATUS[code] ?? 'unknown',
      raw: response.data?.statusMessage ?? code,
    };
  }

  async stop(): Promise<void> {
    // The headless wallet outlives this process, so there is nothing to release. Defined as a
    // no-op rather than left unimplemented: the contract says stop is safe to call twice.
  }

  // ---- addresses -----------------------------------------------------------------------------

  async getAddressAtIndex(index: number): Promise<string> {
    const cached = this.addressCache.get(index);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.http.send<HeadlessAddressResponse>({
      method: 'GET',
      path: 'wallet/address',
      headers: this.headers(),
      // Deliberately without mark_as_used: this must not advance the wallet's internal cursor,
      // or every proposal grows the address set the wallet has to track and re-sync.
      query: { index },
    });

    const address = this.assertOk(response, `getAddressAtIndex(${index})`).address;
    if (!address) {
      throw new WalletOperationError(`getAddressAtIndex(${index}) returned no address.`);
    }

    this.addressCache.set(index, address);
    return address;
  }

  async isOwnAddress(address: string): Promise<boolean> {
    const response = await this.http.send<HeadlessAddressIndexResponse>({
      method: 'GET',
      path: 'wallet/address-index',
      headers: this.headers(),
      query: { address },
    });

    if (response.status !== 200) {
      throw new WalletOperationError(
        `isOwnAddress failed: ${response.status} ${JSON.stringify(response.data)}`,
        response.data?.error,
      );
    }

    return response.data?.success === true;
  }

  // ---- reading -------------------------------------------------------------------------------

  async getHistory(): Promise<HistoryEntry[]> {
    const response = await this.http.send<HeadlessTx[]>({
      method: 'GET',
      path: 'wallet/tx-history',
      headers: this.headers(),
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new WalletOperationError(`getHistory failed: ${response.status} ${JSON.stringify(response.data)}`);
    }

    return response.data
      .map((tx) => mapTx(tx))
      .filter(
        (tx): tx is DecodedTx & { txId: string; timestamp: number } =>
          typeof tx.txId === 'string' && typeof tx.timestamp === 'number',
      )
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getTransaction(txId: string): Promise<DecodedTx | undefined> {
    const response = await this.http.send<HeadlessTx & HeadlessResponse>({
      method: 'GET',
      path: 'wallet/transaction',
      headers: this.headers(),
      query: { id: txId },
    });

    // Unknown and voided both mean "nothing to act on", and must stay distinguishable from a
    // failed call - the caller's decisions are opposite.
    if (response.status !== 200 || response.data?.error || response.data?.is_voided) {
      return undefined;
    }

    return mapTx(response.data);
  }

  async getConfirmationCount(txId: string): Promise<number> {
    const response = await this.http.send<HeadlessConfirmationResponse>({
      method: 'GET',
      path: 'wallet/tx-confirmation-blocks',
      headers: this.headers(),
      query: { id: txId },
    });

    return this.assertOk(response, 'getConfirmationCount').confirmationNumber ?? 0;
  }

  async decodeTxHex(txHex: string): Promise<DecodedTx> {
    const response = await this.http.send<HeadlessDecodeResponse>({
      method: 'POST',
      path: 'wallet/decode',
      headers: this.headers(),
      body: { txHex },
    });

    const tx = this.assertOk(response, 'decodeTxHex').tx;
    if (!tx) {
      throw new WalletOperationError('decodeTxHex returned no transaction.');
    }

    return mapTx(tx);
  }

  // ---- proposals -----------------------------------------------------------------------------

  private async proposal(path: string, body: Record<string, unknown>, operation: string): Promise<string> {
    const response = await this.http.send<HeadlessProposalResponse>({
      method: 'POST',
      path,
      headers: this.headers(),
      body,
    });

    const txHex = this.assertOk(response, operation).txHex;
    if (!txHex) {
      throw new WalletOperationError(`${operation} returned no txHex.`);
    }
    return txHex;
  }

  async createMintProposal(request: MintProposalRequest): Promise<string> {
    return this.proposal(
      'wallet/p2sh/tx-proposal/mint-tokens',
      {
        address: request.receiverAddress,
        amount: Number(request.amount),
        token: request.token,
        mark_inputs_as_used: request.markInputsAsUsed,
        ttl: request.inputLockTtlMs,
        // Pin change and authority outputs to a known address of ours rather than letting the
        // wallet fall back to its auto-incrementing default.
        change_address: request.fixedAddress,
        mint_authority_address: request.fixedAddress,
      },
      'createMintProposal',
    );
  }

  async createMeltProposal(request: MeltProposalRequest): Promise<string> {
    return this.proposal(
      'wallet/p2sh/tx-proposal/melt-tokens',
      {
        amount: Number(request.amount),
        token: request.token,
        mark_inputs_as_used: request.markInputsAsUsed,
        ttl: request.inputLockTtlMs,
        // A melt has no external recipient: the deposit, change and melt-authority outputs all
        // come back to us, so all three are pinned to the same known address.
        deposit_address: request.fixedAddress,
        change_address: request.fixedAddress,
        melt_authority_address: request.fixedAddress,
      },
      'createMeltProposal',
    );
  }

  async createTransferProposal(request: TransferProposalRequest): Promise<string> {
    return this.proposal(
      'wallet/p2sh/tx-proposal',
      {
        outputs: request.outputs.map((output) => ({
          address: output.address,
          value: Number(output.value),
          token: output.token,
        })),
        mark_inputs_as_used: request.markInputsAsUsed,
        ttl: request.inputLockTtlMs,
        change_address: request.fixedAddress,
      },
      'createTransferProposal',
    );
  }

  async getMySignatures(txHex: string): Promise<string> {
    const response = await this.http.send<HeadlessSignaturesResponse>({
      method: 'POST',
      path: 'wallet/p2sh/tx-proposal/get-my-signatures',
      headers: this.headers(),
      body: { txHex },
    });

    const signatures = this.assertOk(response, 'getMySignatures').signatures;
    if (!signatures) {
      throw new WalletOperationError('getMySignatures returned no signatures.');
    }
    return signatures;
  }

  async signAndPush(txHex: string, signatures: readonly string[]): Promise<string> {
    const response = await this.http.send<HeadlessPushResponse>({
      method: 'POST',
      path: 'wallet/p2sh/tx-proposal/sign-and-push',
      headers: this.headers(),
      body: { txHex, signatures: [...signatures] },
    });

    const hash = this.assertOk(response, 'signAndPush').hash;
    if (!hash) {
      throw new WalletOperationError('signAndPush returned no transaction hash.');
    }
    return hash;
  }

  async lockProposalInputs(txHex: string, ttlMs: number): Promise<void> {
    const response = await this.http.send<HeadlessResponse>({
      method: 'PUT',
      path: 'wallet/utxos-selected-as-input',
      headers: this.headers(),
      body: { txHex, ttl: ttlMs },
    });

    this.assertOk(response, 'lockProposalInputs');
  }

  onNewTransaction(_handler: (tx: HistoryEntry) => void | Promise<void>): void {
    // The headless wallet has no in-process channel for this - it pushed onto a message queue,
    // which is precisely what the migration removes. Rather than silently registering a handler
    // that will never fire, this says so: on this adapter the history replay is the only source.
    throw new WalletOperationError(
      'The headless adapter cannot deliver new-transaction events in process. Poll getHistory ' +
        'instead, or use the wallet-lib adapter.',
    );
  }
}
