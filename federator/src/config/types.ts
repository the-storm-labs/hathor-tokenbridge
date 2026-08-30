/**
 * The shape the rest of the application sees. Nothing below this module reads `process.env`:
 * configuration enters once, at the composition root, already parsed and validated.
 *
 * Three chains are involved and they are deliberately kept apart, because they were conflated in
 * the previous configuration and that conflation hid a live bug (see config/schema.ts):
 *
 *  - `evm`    the chain carrying the Bridge, Federation and AllowTokens contracts. `Cross` events
 *             are read from here and votes are cast here.
 *  - `state`  the chain carrying the HathorFederation contract, which is where federators
 *             coordinate proposals and signatures. It may or may not be the same chain as `evm`.
 *  - `hathor` the Hathor network itself.
 */

export interface EvmChainConfig {
  readonly name: string;
  readonly chainId: number;
  readonly host: string;
  readonly bridgeAddress: string;
  readonly federationAddress: string;
  readonly allowTokensAddress: string;
  /** Block to start from when no cursor has been persisted yet. */
  readonly fromBlock: number;
  readonly blockTimeMs: number;
}

/** The chain hosting the HathorFederation coordination contract. */
export interface StateChainConfig {
  readonly chainId: number;
  readonly host: string;
  readonly contractAddress: string;
  readonly fromBlock: number;
  /** How far behind the head to stay before treating a block as settled. */
  readonly confirmationBlocks: number;
}

export interface HathorMultisigConfig {
  /** Every participant's xpub, in the exact order the multisig was created with. */
  readonly pubkeys: readonly string[];
  /** Signatures required to redeem - the `numSignatures` of the P2SH multisig itself. */
  readonly numSignatures: number;
  /** This federator's 1-based position. Only order 1 creates proposals; the rest only sign. */
  readonly order: number;
}

export interface HeadlessWalletConfig {
  readonly url: string;
  readonly apiKey: string;
}

export interface HathorConfig {
  readonly name: string;
  /** Synthetic chain id used to key Hathor in the bridge's token maps. Not a real EVM chain. */
  readonly chainId: number;
  readonly network: 'mainnet' | 'testnet' | 'privatenet';
  readonly fullnodeUrl: string;
  readonly txMiningUrl: string;
  /** Multisig seed words. Held in-process once the wallet-lib adapter is live. */
  readonly seed: string;
  readonly multisig: HathorMultisigConfig;
  /** Address-scan gap limit. The lever that decides how much history a sync walks. */
  readonly gapLimit: number;
  readonly minConfirmations: number;
  /**
   * How long a UTXO stays marked as selected-as-input, in MILLISECONDS - the value is handed
   * straight to setTimeout. See schema.ts for why this carries an explicit unit in its name.
   */
  readonly inputLockTtlMs: number;
  /** Unix seconds to replay Hathor history from when no cursor has been persisted yet. */
  readonly fromTimestamp: number;
  /**
   * Transitional: only the headless HTTP adapter reads this. It exists so both adapters can be
   * configured side by side while their behaviour is compared, and goes away with the container.
   */
  readonly headless?: HeadlessWalletConfig | undefined;
}

export interface FederatorIdentity {
  readonly privateKey: string;
  /** Always derived from `privateKey`, never merely trusted from the environment. */
  readonly address: string;
}

export interface RuntimeConfig {
  readonly storagePath: string;
  readonly endpointsPort: number;
  readonly pollingIntervalMs: number;
  readonly retries: number;
  readonly requireHttps: boolean;
  readonly etherscanApiKey?: string | undefined;
  readonly explorerUrl?: string | undefined;
  readonly logFile: string;
  readonly logLevel: string;
}

export interface AppConfig {
  readonly evm: EvmChainConfig;
  readonly state: StateChainConfig;
  readonly hathor: HathorConfig;
  readonly federator: FederatorIdentity;
  readonly runtime: RuntimeConfig;
}
