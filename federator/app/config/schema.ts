import { z } from 'zod';

/**
 * The environment contract, as a schema. Every variable the application reads is declared here
 * exactly once, so a missing or malformed one fails at boot with a named error instead of
 * surfacing as `undefined` ten layers down.
 *
 * This replaces two JSON blobs (`EVM_CONFIG` and `HTR_CONFIG`) that were parsed with a bare
 * `JSON.parse` and never validated. That arrangement hid a real bug for the life of the project:
 * the HathorFederation contract factory read `FEDERATION_CHAIN`, a variable set nowhere - not in
 * any .env, not in either compose file - while the value actually provided was
 * `FEDERATION_CHAIN_ID`. The contract wrapper has been carrying `chainId: NaN` ever since, in
 * total silence. Here that variable is `STATE_CHAIN_ID`, it is required, and it must parse.
 */

const evmAddress = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, `${label} must be a 0x-prefixed 20-byte address`);

const httpUrl = (label: string) =>
  z
    .string()
    .trim()
    .url(`${label} must be a URL`)
    .refine((v) => v.startsWith('http://') || v.startsWith('https://'), `${label} must be http(s)`);

/**
 * Environment values are always strings, so numbers are coerced. `z.coerce.number()` alone would
 * accept '' and 'Infinity' (Number('') is 0), which is how a blank variable becomes a silently
 * valid zero - the class of failure this schema exists to prevent.
 */
const intFromEnv = (label: string) =>
  z
    .string()
    .trim()
    // superRefine rather than chained .refine calls: chained refinements all run, so a blank
    // variable would report both "must not be empty" and "must be an integer" for one mistake.
    .superRefine((v, ctx) => {
      if (v.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not be empty` });
        return;
      }
      if (!/^-?\d+$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be an integer` });
      }
    })
    .transform((v) => Number.parseInt(v, 10));

const positiveIntFromEnv = (label: string) =>
  intFromEnv(label).refine((v) => v > 0, `${label} must be greater than zero`);

const nonNegativeIntFromEnv = (label: string) =>
  intFromEnv(label).refine((v) => v >= 0, `${label} must not be negative`);

const boolFromEnv = (label: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => ['true', 'false', '1', '0'].includes(v), `${label} must be true or false`)
    .transform((v) => v === 'true' || v === '1');

const hexPrivateKey = z
  .string()
  .trim()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'FEDERATOR_KEY must be a 32-byte hex private key')
  .transform((v) => (v.startsWith('0x') ? v : `0x${v}`));

/** Comma-separated list, tolerant of whitespace and a trailing separator. */
const csv = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .transform((v) =>
      v
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .refine((parts) => parts.length > 0, `${label} must contain at least one entry`);

const optionalText = z
  .string()
  .trim()
  .min(1)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const envSchema = z.object({
  // ---- EVM chain: Bridge / Federation / AllowTokens -------------------------------------------
  EVM_NAME: z.string().trim().min(1, 'EVM_NAME is required'),
  EVM_CHAIN_ID: positiveIntFromEnv('EVM_CHAIN_ID'),
  EVM_HOST: httpUrl('EVM_HOST'),
  EVM_BRIDGE_ADDRESS: evmAddress('EVM_BRIDGE_ADDRESS'),
  EVM_FEDERATION_ADDRESS: evmAddress('EVM_FEDERATION_ADDRESS'),
  EVM_ALLOW_TOKENS_ADDRESS: evmAddress('EVM_ALLOW_TOKENS_ADDRESS'),
  EVM_FROM_BLOCK: nonNegativeIntFromEnv('EVM_FROM_BLOCK'),
  EVM_BLOCK_TIME_MS: positiveIntFromEnv('EVM_BLOCK_TIME_MS').default('15000'),

  // ---- State chain: the HathorFederation coordination contract --------------------------------
  STATE_CHAIN_ID: positiveIntFromEnv('STATE_CHAIN_ID'),
  STATE_CHAIN_HOST: httpUrl('STATE_CHAIN_HOST'),
  STATE_CONTRACT_ADDRESS: evmAddress('STATE_CONTRACT_ADDRESS'),
  STATE_FROM_BLOCK: nonNegativeIntFromEnv('STATE_FROM_BLOCK'),
  STATE_CONFIRMATION_BLOCKS: nonNegativeIntFromEnv('STATE_CONFIRMATION_BLOCKS'),

  // ---- Hathor ---------------------------------------------------------------------------------
  HATHOR_NAME: z.string().trim().min(1, 'HATHOR_NAME is required'),
  HATHOR_CHAIN_ID: positiveIntFromEnv('HATHOR_CHAIN_ID'),
  HATHOR_NETWORK: z.enum(['mainnet', 'testnet', 'privatenet'], {
    errorMap: () => ({ message: 'HATHOR_NETWORK must be mainnet, testnet or privatenet' }),
  }),
  HATHOR_FULLNODE_URL: httpUrl('HATHOR_FULLNODE_URL'),
  HATHOR_TX_MINING_URL: httpUrl('HATHOR_TX_MINING_URL'),
  HATHOR_SEED: z
    .string()
    .trim()
    .min(1, 'HATHOR_SEED is required')
    .refine(
      (v) => [12, 15, 18, 21, 24].includes(v.split(/\s+/).filter(Boolean).length),
      'HATHOR_SEED must be a 12, 15, 18, 21 or 24 word mnemonic',
    ),
  HATHOR_MULTISIG_PUBKEYS: csv('HATHOR_MULTISIG_PUBKEYS'),
  HATHOR_NUM_SIGNATURES: positiveIntFromEnv('HATHOR_NUM_SIGNATURES'),
  HATHOR_MULTISIG_ORDER: positiveIntFromEnv('HATHOR_MULTISIG_ORDER'),
  HATHOR_GAP_LIMIT: positiveIntFromEnv('HATHOR_GAP_LIMIT').default('20'),
  HATHOR_MIN_CONFIRMATIONS: nonNegativeIntFromEnv('HATHOR_MIN_CONFIRMATIONS'),

  /**
   * Renamed from HATHOR_INPUT_BLOCK_TTL, and the unit is now in the name on purpose. The value
   * goes straight into setTimeout, so it has always been milliseconds - but the shipped
   * .env.example said `1`, i.e. one millisecond, which is no lock at all. Renaming forces the
   * value to be set deliberately rather than carried over from an example that was wrong.
   */
  HATHOR_INPUT_LOCK_TTL_MS: positiveIntFromEnv('HATHOR_INPUT_LOCK_TTL_MS'),
  HATHOR_FROM_TIMESTAMP: nonNegativeIntFromEnv('HATHOR_FROM_TIMESTAMP'),

  // Transitional - only the headless adapter uses these. Removed with the container.
  HATHOR_HEADLESS_URL: httpUrl('HATHOR_HEADLESS_URL').optional(),
  HATHOR_HEADLESS_API_KEY: optionalText,

  // ---- Federator identity ---------------------------------------------------------------------
  FEDERATOR_KEY: hexPrivateKey,
  /** Optional: when present it is checked against the address derived from the key, never trusted. */
  FEDERATOR_ADDRESS: evmAddress('FEDERATOR_ADDRESS').optional(),

  // ---- Runtime --------------------------------------------------------------------------------
  STORAGE_PATH: z.string().trim().min(1).default('./db'),
  ENDPOINTS_PORT: positiveIntFromEnv('ENDPOINTS_PORT').default('5000'),
  POLLING_INTERVAL_MS: positiveIntFromEnv('POLLING_INTERVAL_MS').default('45000'),
  FEDERATOR_RETRIES: positiveIntFromEnv('FEDERATOR_RETRIES').default('3'),
  REQUIRE_HTTPS: boolFromEnv('REQUIRE_HTTPS').default('true'),
  ETHERSCAN_KEY: optionalText,
  EXPLORER_URL: optionalText,
});

export type ParsedEnv = z.infer<typeof envSchema>;
