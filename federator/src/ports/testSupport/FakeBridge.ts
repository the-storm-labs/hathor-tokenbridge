import type {
  AllowTokensPort,
  BridgePort,
  Confirmations,
  CrossEvent,
  TokenMapping,
  TransferLimits,
} from '../BridgePort';

/** In-memory Bridge registry and Cross event log. */
export class FakeBridge implements BridgePort {
  public readonly mappings: TokenMapping[] = [];
  public readonly decimals = new Map<string, number>();
  public readonly crossEvents: CrossEvent[] = [];

  addMapping(mapping: TokenMapping, evmDecimals = 18): this {
    this.mappings.push(mapping);
    // Keyed by the contract, as on chain: a Hathor-native token's pseudo-address has no decimals().
    this.decimals.set(mapping.evmTokenContract, evmDecimals);
    return this;
  }

  async mappingByEvmToken(evmToken: string): Promise<TokenMapping> {
    const found = this.mappings.find((mapping) => mapping.evmToken === evmToken);
    if (!found) {
      throw new Error(`FakeBridge: no mapping for EVM token ${evmToken}`);
    }
    return found;
  }

  async mappingByHathorToken(hathorToken: string): Promise<TokenMapping> {
    const found = this.mappings.find((mapping) => mapping.hathorToken === hathorToken);
    if (!found) {
      throw new Error(`FakeBridge: no mapping for Hathor token ${hathorToken}`);
    }
    return found;
  }

  async getEvmTokenDecimals(evmToken: string): Promise<number> {
    const decimals = this.decimals.get(evmToken);
    if (decimals === undefined) {
      // What web3 does when the address has no contract: the call returns nothing to decode.
      throw new Error(`FakeBridge: ${evmToken} is not a token contract (no decimals)`);
    }
    return decimals;
  }

  async getCrossEvents(fromBlock: number, toBlock: number, destinationChainId: number): Promise<CrossEvent[]> {
    return this.crossEvents.filter(
      (event) =>
        event.blockNumber >= fromBlock &&
        event.blockNumber <= toBlock &&
        event.destinationChainId === destinationChainId,
    );
  }

  async findCrossEvent(transactionHash: string): Promise<CrossEvent | undefined> {
    return this.crossEvents.find((event) => event.transactionHash === transactionHash);
  }
}

export class FakeAllowTokens implements AllowTokensPort {
  /** What any token not in `limitsByToken` gets. */
  public limits: TransferLimits = { allowed: true, min: 0n, mediumAmount: 0n, largeAmount: 0n };
  /** Per-token answers, so a test can tell which token was asked about. */
  public readonly limitsByToken = new Map<string, TransferLimits>();
  public confirmations: Confirmations = {
    smallAmountConfirmations: 1,
    mediumAmountConfirmations: 5,
    largeAmountConfirmations: 10,
  };

  async getLimits(evmToken: string): Promise<TransferLimits> {
    return this.limitsByToken.get(evmToken) ?? this.limits;
  }

  async getConfirmations(): Promise<Confirmations> {
    return this.confirmations;
  }
}
