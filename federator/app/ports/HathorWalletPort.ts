import type { DecodedTx } from '../domain/types';

/**
 * Everything the bridge needs from a Hathor wallet, and nothing more.
 *
 * This is the seam the whole migration turns on. Two adapters implement it: one driving the
 * headless wallet over HTTP (what runs today) and one driving @hathor/wallet-lib in process (what
 * replaces it). A single shared contract suite runs against both, so "the library does what the
 * headless did" becomes something checked rather than hoped.
 *
 * It is also the seam that keeps the option of splitting the contract readers into their own
 * processes open: an HTTP adapter pointed at the wallet-owning process satisfies this interface
 * without anything above it changing.
 *
 * Amounts are bigint, matching wallet-lib 4.x. Adapters convert at their own boundary.
 */

export interface WalletStatus {
  /**
   * `unknown` is deliberately distinct from `error`. A status an adapter does not recognise is
   * not the same as one the wallet reported as failed: the first should be waited out, the second
   * calls for a restart. Collapsing them means a wallet that is merely in a newer transient state
   * gets torn down and re-synced.
   */
  readonly state: 'closed' | 'connecting' | 'syncing' | 'processing' | 'ready' | 'error' | 'unknown';
  /** The raw status as reported by the underlying implementation, for logging. */
  readonly raw?: string | number | undefined;
}

export interface HistoryEntry extends DecodedTx {
  readonly txId: string;
  readonly timestamp: number;
}

export interface TransferOutput {
  readonly address: string;
  readonly value: bigint;
  readonly token: string;
}

export interface ProposalOptions {
  /** Mark the selected UTXOs as spent-for-now, so a concurrent proposal cannot pick them again. */
  readonly markInputsAsUsed: boolean;
  /** How long that mark survives, in milliseconds. */
  readonly inputLockTtlMs: number;
  /**
   * Address for change, deposit and authority outputs. Always the wallet's index-0 address, so
   * proposals stop growing the set of addresses the wallet has to track and re-sync.
   */
  readonly fixedAddress: string;
}

export interface MintProposalRequest extends ProposalOptions {
  readonly token: string;
  readonly amount: bigint;
  readonly receiverAddress: string;
}

export interface MeltProposalRequest extends ProposalOptions {
  readonly token: string;
  readonly amount: bigint;
}

export interface TransferProposalRequest extends ProposalOptions {
  readonly outputs: readonly TransferOutput[];
}

export interface HathorWalletPort {
  /** Bring the wallet up and wait until it can answer. Idempotent. */
  start(): Promise<void>;

  status(): Promise<WalletStatus>;

  /**
   * The wallet's stable address at a derivation index - never `mark_as_used`, so it does not
   * advance the wallet's internal cursor and returns the same value for the life of the process.
   */
  getAddressAtIndex(index: number): Promise<string>;

  /** Whether an address belongs to this wallet. */
  isOwnAddress(address: string): Promise<boolean>;

  /** Full transaction history, newest first. */
  getHistory(): Promise<HistoryEntry[]>;

  /** A single transaction, or undefined when it is unknown or voided. */
  getTransaction(txId: string): Promise<DecodedTx | undefined>;

  /** How many blocks have confirmed a transaction. */
  getConfirmationCount(txId: string): Promise<number>;

  /** Decode a serialised proposal into the domain's transaction shape. */
  decodeTxHex(txHex: string): Promise<DecodedTx>;

  createMintProposal(request: MintProposalRequest): Promise<string>;
  createMeltProposal(request: MeltProposalRequest): Promise<string>;
  createTransferProposal(request: TransferProposalRequest): Promise<string>;

  /** This wallet's signature over every input of a proposal. */
  getMySignatures(txHex: string): Promise<string>;

  /**
   * Assemble the collected signatures onto the proposal and broadcast it.
   *
   * The signature set must contain exactly the multisig's numSignatures entries, each covering
   * every input - assemblePartialTransaction accepts nothing else.
   *
   * @returns the broadcast transaction's id.
   */
  signAndPush(txHex: string, signatures: readonly string[]): Promise<string>;

  /** Mark a proposal's inputs as selected, so nothing else spends them while it is in flight. */
  lockProposalInputs(txHex: string, ttlMs: number): Promise<void>;

  /** Register a callback for transactions arriving at this wallet. */
  onNewTransaction(handler: (tx: HistoryEntry) => void | Promise<void>): void;

  /** Release resources. Safe to call more than once. */
  stop(): Promise<void>;
}

/** Raised when the wallet refuses an operation for a reason worth distinguishing from a transport failure. */
export class WalletOperationError extends Error {
  /** The message the wallet itself gave, when there is one - some of these drive retry decisions. */
  public readonly walletMessage?: string | undefined;

  constructor(message: string, walletMessage?: string) {
    super(message);
    this.name = 'WalletOperationError';
    this.walletMessage = walletMessage;
    Object.setPrototypeOf(this, WalletOperationError.prototype);
  }
}
