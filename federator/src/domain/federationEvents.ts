import type { TransactionType } from './transactionTypes';

/**
 * What the HathorFederation contract announces. This is the coordination protocol between
 * federators, so it is modelled as a closed set of named events rather than as raw log objects -
 * the previous reader switched on `event.event` strings and pulled untyped fields out of
 * `returnValues`, which is how a renamed field becomes `undefined` travelling downstream.
 */

/** The transfer these events all refer to. */
export interface FederationTransfer {
  readonly transactionId: string;
  readonly originalTokenAddress: string;
  readonly transactionHash: string;
  readonly value: bigint;
  readonly sender: string;
  readonly receiver: string;
  readonly transactionType: TransactionType;
}

export interface TransactionProposedEvent extends FederationTransfer {
  readonly kind: 'proposed';
  /** The serialised proposal, without the `0x` prefix. */
  readonly txHex: string;
}

export interface ProposalSignedEvent extends FederationTransfer {
  readonly kind: 'signed';
  readonly member: string;
  readonly signed: boolean;
  readonly signature: string;
}

export interface ProposalSentEvent extends FederationTransfer {
  readonly kind: 'sent';
  readonly processed: boolean;
  /** The transaction's id on Hathor, once it has been pushed. */
  readonly hathorTxId: string;
}

export interface TransactionFailedEvent extends FederationTransfer {
  readonly kind: 'failed';
}

/**
 * Announces the inputs a proposal has claimed, so the other federators can mark the same UTXOs as
 * spoken for before they build anything of their own.
 */
export interface LockInputsEvent {
  readonly kind: 'lock';
  readonly txHex: string;
}

export type FederationEvent =
  | TransactionProposedEvent
  | ProposalSignedEvent
  | ProposalSentEvent
  | TransactionFailedEvent
  | LockInputsEvent;
