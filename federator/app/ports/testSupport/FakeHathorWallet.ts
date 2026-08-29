import type { DecodedTx } from '../../domain/types';
import type {
  HathorWalletPort,
  HistoryEntry,
  MeltProposalRequest,
  MintProposalRequest,
  TransferProposalRequest,
  WalletStatus,
} from '../HathorWalletPort';
import { WalletOperationError } from '../HathorWalletPort';

/**
 * An in-memory HathorWalletPort for testing everything above the port.
 *
 * It is a real implementation, not a mock: it satisfies the same contract suite the HTTP and
 * wallet-lib adapters do, so a use-case test written against it is testing against behaviour the
 * production adapters are also held to - rather than against whatever a `jest.fn()` was told to
 * return that day.
 */
export class FakeHathorWallet implements HathorWalletPort {
  private started = false;
  private stopped = false;
  private state: WalletStatus['state'] = 'closed';

  /** Addresses this wallet owns, by derivation index. */
  public readonly addresses: string[] = ['HFakeMultisigAddress0', 'HFakeMultisigAddress1'];
  public history: HistoryEntry[] = [];
  public confirmations = new Map<string, number>();
  /** Decode results keyed by txHex; a hex with no entry decodes to an empty transaction. */
  public decoded = new Map<string, DecodedTx>();
  /** Signature this wallet produces, keyed by txHex. */
  public signatures = new Map<string, string>();
  /** Set to make signAndPush fail with a specific wallet message. */
  public pushFailure?: string;
  public lockedInputs: Array<{ txHex: string; ttlMs: number }> = [];
  public pushed: Array<{ txHex: string; signatures: readonly string[] }> = [];
  public proposals: Array<
    | ({ kind: 'mint' } & MintProposalRequest)
    | ({ kind: 'melt' } & MeltProposalRequest)
    | ({ kind: 'transfer' } & TransferProposalRequest)
  > = [];

  private handlers: Array<(tx: HistoryEntry) => void | Promise<void>> = [];
  private nextProposalId = 0;

  async start(): Promise<void> {
    this.started = true;
    this.stopped = false;
    this.state = 'ready';
  }

  async status(): Promise<WalletStatus> {
    return { state: this.state, raw: this.state };
  }

  private assertReady(): void {
    if (!this.started || this.stopped) {
      throw new WalletOperationError('Wallet is not started.');
    }
  }

  async getAddressAtIndex(index: number): Promise<string> {
    this.assertReady();
    const address = this.addresses[index];
    if (address === undefined) {
      throw new WalletOperationError(`No address at index ${index}.`);
    }
    return address;
  }

  async isOwnAddress(address: string): Promise<boolean> {
    this.assertReady();
    return this.addresses.includes(address);
  }

  async getHistory(): Promise<HistoryEntry[]> {
    this.assertReady();
    return [...this.history].sort((a, b) => b.timestamp - a.timestamp);
  }

  async getTransaction(txId: string): Promise<DecodedTx | undefined> {
    this.assertReady();
    const found = this.history.find((entry) => entry.txId === txId);
    if (!found || found.isVoided === true) {
      return undefined;
    }
    return found;
  }

  async getConfirmationCount(txId: string): Promise<number> {
    this.assertReady();
    return this.confirmations.get(txId) ?? 0;
  }

  async decodeTxHex(txHex: string): Promise<DecodedTx> {
    this.assertReady();
    return this.decoded.get(txHex) ?? { inputs: [], outputs: [] };
  }

  async createMintProposal(request: MintProposalRequest): Promise<string> {
    this.assertReady();
    this.proposals.push({ kind: 'mint', ...request });
    return `mint-proposal-${this.nextProposalId++}`;
  }

  async createMeltProposal(request: MeltProposalRequest): Promise<string> {
    this.assertReady();
    this.proposals.push({ kind: 'melt', ...request });
    return `melt-proposal-${this.nextProposalId++}`;
  }

  async createTransferProposal(request: TransferProposalRequest): Promise<string> {
    this.assertReady();
    this.proposals.push({ kind: 'transfer', ...request });
    return `transfer-proposal-${this.nextProposalId++}`;
  }

  async getMySignatures(txHex: string): Promise<string> {
    this.assertReady();
    const signature = this.signatures.get(txHex);
    if (signature === undefined) {
      throw new WalletOperationError(`No signature configured for ${txHex}.`);
    }
    return signature;
  }

  async signAndPush(txHex: string, signatures: readonly string[]): Promise<string> {
    this.assertReady();
    if (this.pushFailure !== undefined) {
      throw new WalletOperationError(`Push failed: ${this.pushFailure}`, this.pushFailure);
    }
    this.pushed.push({ txHex, signatures: [...signatures] });
    return `pushed-${txHex}`;
  }

  async lockProposalInputs(txHex: string, ttlMs: number): Promise<void> {
    this.assertReady();
    this.lockedInputs.push({ txHex, ttlMs });
  }

  onNewTransaction(handler: (tx: HistoryEntry) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.state = 'closed';
  }

  // ---- test controls -------------------------------------------------------------------------

  /** Delivers a transaction as if it had just arrived, and records it in the history. */
  async emitNewTransaction(tx: HistoryEntry): Promise<void> {
    this.history.push(tx);
    for (const handler of this.handlers) {
      await handler(tx);
    }
  }

  setState(state: WalletStatus['state']): void {
    this.state = state;
  }
}
