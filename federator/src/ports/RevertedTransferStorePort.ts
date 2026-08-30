/** What is known about a vote that reverted on chain. */
export interface RevertedTransfer {
  readonly originalTokenAddress: string;
  readonly sender: string;
  readonly receiver: string;
  readonly amount: string;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly error?: string | undefined;
}

/**
 * Remembers votes that reverted, so the federator stops re-submitting a transfer the chain has
 * already rejected. A reverting vote costs gas every round and never succeeds.
 */
export interface RevertedTransferStorePort {
  has(transactionId: string): Promise<boolean>;
  record(transactionId: string, details: RevertedTransfer): Promise<void>;
}
