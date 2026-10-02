/** The chain itself, as distinct from any contract on it. */
export interface EvmChainPort {
  getBlockNumber(): Promise<number>;
  /** Whether the node is still catching up. A syncing node returns stale logs. */
  isSyncing(): Promise<boolean>;
}
