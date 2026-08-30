import { privateKeyToAccount } from 'web3-eth-accounts';

import { envSchema } from './schema';
import type { AppConfig, HeadlessWalletConfig } from './types';

/**
 * Raised when the environment does not satisfy the contract in schema.ts. Carries every problem
 * found, not just the first: a federator that is missing four variables should learn that in one
 * boot, not four.
 */
export class ConfigError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Mirrors the old utils.checkHttpsOrLocalhost: plaintext is only acceptable against a local node. */
function isHttpsOrLocalhost(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
}

/**
 * Parses and validates an environment into an `AppConfig`.
 *
 * Pure by design - it takes the environment rather than reaching for `process.env`, so its
 * behaviour is fully exercisable from tests without mutating global state, and so that nothing
 * downstream has an excuse to read the environment itself.
 *
 * @throws ConfigError listing every problem found.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.');
      // A missing variable reads as "Required" from zod alone, which does not say which one.
      return path && !issue.message.includes(path) ? `${path}: ${issue.message}` : issue.message;
    });
    throw new ConfigError(issues);
  }

  const e = parsed.data;
  const issues: string[] = [];

  // The address is always derived. Previously FEDERATOR_ADDRESS was taken on faith and used to
  // ask the federation contract "have I already voted?" - a stale value there means the federator
  // silently checks somebody else's vote and re-votes forever.
  const derivedAddress = privateKeyToAccount(e.FEDERATOR_KEY).address;
  if (e.FEDERATOR_ADDRESS && e.FEDERATOR_ADDRESS.toLowerCase() !== derivedAddress.toLowerCase()) {
    issues.push(
      `FEDERATOR_ADDRESS (${e.FEDERATOR_ADDRESS}) does not match the address derived from ` +
        `FEDERATOR_KEY (${derivedAddress}). Remove it, or point it at the right key.`,
    );
  }

  const participants = e.HATHOR_MULTISIG_PUBKEYS.length;
  if (e.HATHOR_NUM_SIGNATURES > participants) {
    issues.push(
      `HATHOR_NUM_SIGNATURES (${e.HATHOR_NUM_SIGNATURES}) exceeds the ${participants} ` +
        `pubkey(s) in HATHOR_MULTISIG_PUBKEYS - the multisig could never reach quorum.`,
    );
  }
  if (e.HATHOR_MULTISIG_ORDER > participants) {
    issues.push(
      `HATHOR_MULTISIG_ORDER (${e.HATHOR_MULTISIG_ORDER}) exceeds the ${participants} ` +
        `pubkey(s) in HATHOR_MULTISIG_PUBKEYS.`,
    );
  }

  if (e.REQUIRE_HTTPS) {
    for (const [name, url] of [
      ['EVM_HOST', e.EVM_HOST],
      ['STATE_CHAIN_HOST', e.STATE_CHAIN_HOST],
      ['HATHOR_FULLNODE_URL', e.HATHOR_FULLNODE_URL],
    ] as const) {
      if (!isHttpsOrLocalhost(url)) {
        issues.push(`${name} must use https (or point at localhost) while REQUIRE_HTTPS is on.`);
      }
    }
  }

  // Half-configured headless access fails at the first call rather than at boot, so reject it here.
  const hasHeadlessUrl = e.HATHOR_HEADLESS_URL !== undefined;
  const hasHeadlessKey = e.HATHOR_HEADLESS_API_KEY !== undefined;
  if (hasHeadlessUrl !== hasHeadlessKey) {
    issues.push('HATHOR_HEADLESS_URL and HATHOR_HEADLESS_API_KEY must be set together, or not at all.');
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  const headless: HeadlessWalletConfig | undefined =
    hasHeadlessUrl && hasHeadlessKey
      ? { url: e.HATHOR_HEADLESS_URL as string, apiKey: e.HATHOR_HEADLESS_API_KEY as string }
      : undefined;

  return {
    evm: {
      name: e.EVM_NAME,
      chainId: e.EVM_CHAIN_ID,
      host: e.EVM_HOST,
      bridgeAddress: e.EVM_BRIDGE_ADDRESS,
      federationAddress: e.EVM_FEDERATION_ADDRESS,
      allowTokensAddress: e.EVM_ALLOW_TOKENS_ADDRESS,
      fromBlock: e.EVM_FROM_BLOCK,
      blockTimeMs: e.EVM_BLOCK_TIME_MS,
    },
    state: {
      chainId: e.STATE_CHAIN_ID,
      host: e.STATE_CHAIN_HOST,
      contractAddress: e.STATE_CONTRACT_ADDRESS,
      fromBlock: e.STATE_FROM_BLOCK,
      confirmationBlocks: e.STATE_CONFIRMATION_BLOCKS,
    },
    hathor: {
      name: e.HATHOR_NAME,
      chainId: e.HATHOR_CHAIN_ID,
      network: e.HATHOR_NETWORK,
      fullnodeUrl: e.HATHOR_FULLNODE_URL,
      txMiningUrl: e.HATHOR_TX_MINING_URL,
      seed: e.HATHOR_SEED,
      multisig: {
        pubkeys: e.HATHOR_MULTISIG_PUBKEYS,
        numSignatures: e.HATHOR_NUM_SIGNATURES,
        order: e.HATHOR_MULTISIG_ORDER,
      },
      gapLimit: e.HATHOR_GAP_LIMIT,
      minConfirmations: e.HATHOR_MIN_CONFIRMATIONS,
      inputLockTtlMs: e.HATHOR_INPUT_LOCK_TTL_MS,
      fromTimestamp: e.HATHOR_FROM_TIMESTAMP,
      headless,
    },
    federator: {
      privateKey: e.FEDERATOR_KEY,
      address: derivedAddress,
    },
    runtime: {
      storagePath: e.STORAGE_PATH,
      endpointsPort: e.ENDPOINTS_PORT,
      pollingIntervalMs: e.POLLING_INTERVAL_MS,
      retries: e.FEDERATOR_RETRIES,
      requireHttps: e.REQUIRE_HTTPS,
      etherscanApiKey: e.ETHERSCAN_KEY,
      explorerUrl: e.EXPLORER_URL,
      logFile: e.LOG_FILE,
      logLevel: e.LOG_LEVEL,
    },
  };
}
