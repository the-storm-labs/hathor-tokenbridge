import { MemoryStore, Network, Storage } from '@hathor/wallet-lib';

import type { LoggerPort } from '../../../ports/LoggerPort';
import type { LibWalletDriver, WalletLibAdapterConfig } from '../WalletLibAdapter';

/**
 * A stand-in for the library's HathorWallet, exposing only the surface WalletLibAdapter touches.
 *
 * This deliberately does NOT stub the library's pure helpers - `createTxFromHex`, `parseScript`,
 * `getWeightConstantsFromStorage` and the transaction model are the real ones. Those are the parts
 * the adapter's glue is made of, so stubbing them would leave nothing under test.
 */
export class StubLibWallet {
  public state = 3; // READY
  /**
   * A real Storage over a real MemoryStore, so the library's own helpers work on it - with
   * `txHistory` overridden to serve this stub's history, which is the path the adapter reads.
   * Overriding rather than replacing keeps everything else (weight constants, for one) genuine.
   */
  public storage = Object.assign(new Storage(new MemoryStore()), {
    txHistory: async function* (this: StubLibWallet) {
      yield* this.history as never[];
    }.bind(this),
  });

  public addresses = new Map<number, string>([[0, 'wXonH2U9Bys5EcYsFspZyBVqeTVQ3Htf4Q']]);
  public history: unknown[] = [];
  public ownAddresses = new Set<string>(['wXonH2U9Bys5EcYsFspZyBVqeTVQ3Htf4Q']);
  public txs = new Map<string, unknown>();
  public fullTxs = new Map<string, { meta?: { height?: number | null } }>();

  public signature = 'pub|0:aaaa';
  public assembled?: { txHex: string; signatures: string[] };
  public preparedWeightConstants?: unknown;
  public pushedTx?: unknown;
  public pushHash = 'pushed-hash';
  public bestBlockHeight = 1_000;

  public readonly markedUtxos: Array<{ txId: string; index: number; value: boolean; ttl?: number | undefined }> = [];
  public readonly mintCalls: Array<[string, bigint, Record<string, unknown>]> = [];
  public readonly meltCalls: Array<[string, bigint, Record<string, unknown>]> = [];
  public readonly listeners = new Map<string, Array<(payload: unknown) => void>>();

  /** The hex a prepared proposal reports; set per test. */
  public proposalHex = 'deadbeef';

  private proposal() {
    return { toHex: () => this.proposalHex };
  }

  /**
   * Deliberately does not force the state: `state` is what the test is controlling, and the real
   * library reaches READY on its own schedule rather than the moment start() resolves.
   */
  async start(): Promise<void> {
    // Intentionally empty - see above.
  }
  async stop(): Promise<void> {
    this.state = 0;
  }

  async getAddressAtIndex(index: number): Promise<string> {
    const address = this.addresses.get(index);
    if (!address) {
      throw new Error(`StubLibWallet: no address at index ${index}`);
    }
    return address;
  }

  async isAddressMine(address: string): Promise<boolean> {
    return this.ownAddresses.has(address);
  }

  async getTxHistory(): Promise<unknown[]> {
    return this.history;
  }

  async getTx(id: string): Promise<unknown> {
    return this.txs.get(id) ?? null;
  }

  async getFullTxById(id: string): Promise<{ meta?: { height?: number | null } }> {
    return this.fullTxs.get(id) ?? {};
  }

  async prepareMintTokensData(token: string, amount: bigint, options: Record<string, unknown>) {
    this.mintCalls.push([token, amount, options]);
    return this.proposal();
  }

  async prepareMeltTokensData(token: string, amount: bigint, options: Record<string, unknown>) {
    this.meltCalls.push([token, amount, options]);
    return this.proposal();
  }

  async getAllSignatures(): Promise<string> {
    return this.signature;
  }

  async assemblePartialTransaction(txHex: string, signatures: string[]) {
    this.assembled = { txHex, signatures };
    return {
      hash: this.pushHash,
      prepareToSend: (weightConstants: unknown) => {
        this.preparedWeightConstants = weightConstants;
      },
    };
  }

  async markUtxoSelected(txId: string, index: number, value: boolean, ttl?: number): Promise<void> {
    this.markedUtxos.push({ txId, index, value, ttl });
  }

  on(event: string, listener: (payload: unknown) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  /** Fires a wallet event the way the library would. */
  emitNewTx(tx: unknown): void {
    for (const listener of this.listeners.get('new-tx') ?? []) {
      listener(tx);
    }
  }
}

/** A driver handing the adapter a stub instead of a real, network-bound wallet. */
export function stubWalletDriver(stub: StubLibWallet): LibWalletDriver {
  return {
    create(config: WalletLibAdapterConfig, _logger: LoggerPort) {
      return {
        wallet: stub as never,
        network: new Network(config.network),
      };
    },
    async push(_wallet, transaction) {
      stub.pushedTx = transaction;
      return { hash: stub.pushHash };
    },
    async bestBlockHeight() {
      return stub.bestBlockHeight;
    },
  };
}
