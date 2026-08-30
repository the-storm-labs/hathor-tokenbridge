/**
 * The domain's view of a Hathor transaction.
 *
 * Values are `bigint` throughout, matching @hathor/wallet-lib 4.x where `OutputValueType` is
 * `bigint`. The previous code carried them as `number` because the headless wallet's HTTP boundary
 * serialised them as JSON numbers; with the library embedded, that boundary is gone and `number`
 * would silently truncate above 2^53.
 */

export interface DecodedScript {
  /** 'P2PKH', 'MultiSig', or undefined for outputs whose script is not an address script. */
  readonly type?: string | undefined;
  readonly address?: string | undefined;
  readonly timelock?: number | null | undefined;
}

export interface TxInput {
  readonly value: bigint;
  readonly tokenData: number;
  readonly script: string;
  readonly token: string;
  readonly decoded: DecodedScript;
  readonly txId?: string | undefined;
  readonly index?: number | undefined;
  /** Whether the spent output belonged to our own wallet. Only known for decoded proposals. */
  readonly mine?: boolean | undefined;
}

export interface TxOutput {
  readonly value: bigint;
  readonly tokenData: number;
  readonly script: string;
  readonly token: string;
  readonly decoded: DecodedScript;
  /** Set when this output has already been consumed by another transaction. */
  readonly spentBy?: string | null | undefined;
  /** Whether the output belongs to our own wallet. Only known for decoded proposals. */
  readonly mine?: boolean | undefined;
}

export interface DecodedTx {
  readonly txId?: string | undefined;
  readonly version?: number | undefined;
  readonly timestamp?: number | undefined;
  readonly isVoided?: boolean | undefined;
  readonly inputs: readonly TxInput[];
  readonly outputs: readonly TxOutput[];
}

/** A custom token moving through the bridge, as read off a transaction. */
export interface BridgedToken {
  readonly tokenAddress: string;
  readonly senderAddress: string;
  readonly receiverAddress: string;
  readonly amount: bigint;
}

/** Net effect of a transaction, per token, plus which authorities it spends. */
export interface TransactionEffect {
  /** Outputs minus inputs, per token. Positive means minted, negative means melted. */
  readonly balances: ReadonlyMap<string, bigint>;
  readonly canMint: ReadonlySet<string>;
  readonly canMelt: ReadonlySet<string>;
}
