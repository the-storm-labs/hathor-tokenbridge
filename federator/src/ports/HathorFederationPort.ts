import type { FederationEvent } from '../domain/federationEvents';
import type { TransactionType } from '../domain/transactionTypes';

/**
 * The HathorFederation contract, which is where federators coordinate: it holds each pending
 * transfer's proposal, the signatures collected for it, and whether it has been settled.
 *
 * The port deliberately exposes intentions ("submit this signature") rather than the two-step
 * build-ABI-then-send-transaction dance the contract wrapper actually performs. ABI encoding and
 * transaction sending are the adapter's business; a use case that knows about them cannot be
 * tested without a chain.
 */

/**
 * The six fields that identify a transfer. The contract derives the transaction id from exactly
 * these, so every federator must present them identically or they will coordinate on different
 * ids and never reach quorum.
 */
export interface ProposalIdentity {
  readonly originalTokenAddress: string;
  readonly transactionHash: string;
  /**
   * The amount in the ORIGIN chain's units - the EVM amount for MINT and TRANSFER, the Hathor
   * amount for MELT. It is an opaque coordination key here, not something to convert.
   */
  readonly value: bigint;
  readonly sender: string;
  readonly receiver: string;
  readonly transactionType: TransactionType;
}

export interface SubmitResult {
  readonly status: boolean;
  readonly transactionHash?: string | undefined;
}

export interface HathorFederationPort {
  /** The contract's own id for a transfer. Derived, not chosen. */
  getTransactionId(identity: ProposalIdentity): Promise<string>;

  /** Whether the transfer has already been settled on Hathor. */
  isProcessed(transactionId: string): Promise<boolean>;

  /** Whether this federator has already contributed its signature. */
  isSigned(transactionId: string, federatorAddress: string): Promise<boolean>;

  /** Whether a proposal exists for the transfer yet. */
  isProposed(transactionId: string): Promise<boolean>;

  /** The proposal's serialised transaction, without the `0x` prefix. */
  getTransactionHex(transactionId: string): Promise<string>;

  /** Every signature collected so far, in the order the contract stores them. */
  getSignatures(transactionId: string): Promise<string[]>;

  /**
   * Events the contract emitted in a block range, in the order it emitted them.
   *
   * `kinds` narrows the read, which the reader uses to make one pass over lock events before the
   * general pass - proposals have to be known locally before anything acts on them.
   */
  getEvents(fromBlock: number, toBlock: number, kinds?: readonly FederationEvent['kind'][]): Promise<FederationEvent[]>;

  submitProposal(identity: ProposalIdentity, txHex: string): Promise<SubmitResult>;
  submitSignature(identity: ProposalIdentity, signature: string): Promise<SubmitResult>;

  /**
   * Records how the push turned out: whether the transaction reached Hathor and, if it did, its
   * id there. This is what marks the transfer processed.
   */
  submitOutcome(identity: ProposalIdentity, sent: boolean, hathorTxId: string): Promise<SubmitResult>;
}
