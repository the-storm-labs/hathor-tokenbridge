/**
 * The Federation contract on the EVM side: where federators vote to release a transfer that
 * originated on Hathor.
 */

export interface VoteRequest {
  readonly originalTokenAddress: string;
  readonly sender: string;
  readonly receiver: string;
  readonly amount: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly originChainId: number;
  readonly destinationChainId: number;
}

export interface VoteReceipt {
  readonly status: boolean;
  readonly transactionHash?: string | undefined;
  readonly error?: string | undefined;
}

export interface EvmFederationPort {
  /** The contract's id for a transfer. Derived from the vote's fields. */
  getTransactionId(request: VoteRequest): Promise<string>;
  transactionWasProcessed(transactionId: string): Promise<boolean>;
  hasVoted(transactionId: string, federatorAddress: string): Promise<boolean>;
  vote(request: VoteRequest): Promise<VoteReceipt>;
}
