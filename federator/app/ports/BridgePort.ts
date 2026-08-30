/**
 * The Bridge contract's token registry, and the `Cross` events it emits when funds are locked.
 */

export interface CrossEvent {
  readonly transactionHash: string;
  readonly blockHash: string;
  readonly blockNumber: number;
  readonly logIndex: number;
  readonly receiver: string;
  readonly sender: string;
  readonly amount: bigint;
  readonly tokenAddress: string;
  readonly originChainId: number;
  readonly destinationChainId: number;
}

/** A token as the bridge knows it on both sides. */
export interface TokenMapping {
  /** The token's address on Hathor. */
  readonly hathorToken: string;
  /** The token's address on the EVM side. */
  readonly evmToken: string;
  /** The chain the token is native to. */
  readonly originChainId: number;
}

export interface BridgePort {
  /** Resolves a token given its EVM address. */
  mappingByEvmToken(evmToken: string): Promise<TokenMapping>;
  /** Resolves a token given its Hathor address. */
  mappingByHathorToken(hathorToken: string): Promise<TokenMapping>;
  /** Decimals of the token as deployed on the EVM side. */
  getEvmTokenDecimals(evmToken: string): Promise<number>;
  /** `Cross` events in a block range, bound for the given destination chain. */
  getCrossEvents(fromBlock: number, toBlock: number, destinationChainId: number): Promise<CrossEvent[]>;

  /**
   * The `Cross` event a transaction emitted, or undefined when it emitted none.
   *
   * Phrased as "the event for this transaction" rather than "look up the block, then scan it":
   * a proposal validator wants the event, and how the adapter finds it is the adapter's business.
   */
  findCrossEvent(transactionHash: string): Promise<CrossEvent | undefined>;
}

export interface TransferLimits {
  readonly allowed: boolean;
  readonly min: bigint;
  readonly mediumAmount: bigint;
  readonly largeAmount: bigint;
}

export interface Confirmations {
  readonly smallAmountConfirmations: number;
  readonly mediumAmountConfirmations: number;
  readonly largeAmountConfirmations: number;
}

/** The AllowTokens contract: per-token limits and the confirmation depths they require. */
export interface AllowTokensPort {
  getLimits(evmToken: string): Promise<TransferLimits>;
  getConfirmations(): Promise<Confirmations>;
}
