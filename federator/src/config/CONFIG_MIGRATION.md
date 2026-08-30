# Configuration migration: old federator -> `app/` tree

The previous federator was configured by `config/config.js`, which did a bare `JSON.parse` on two
environment variables holding whole JSON documents (`EVM_CONFIG`, `HTR_CONFIG`), plus fourteen
loose `process.env` reads scattered through the business logic. Nothing was validated.

Configuration now enters exactly once, through `loadConfig(env)` in `app/config/load.ts`, against
the schema in `app/config/schema.ts`. Nothing below the composition root reads `process.env`.

## Why the names changed

Three renames are deliberate rather than cosmetic:

- **`FEDERATION_CHAIN` -> `STATE_CHAIN_ID`.** `contracts/HathorFederationFactory.ts:13` read
  `process.env.FEDERATION_CHAIN`, a variable set nowhere - not in any `.env`, not in either compose
  file. The value actually provided was `FEDERATION_CHAIN_ID`. `Number.parseInt(undefined)` is
  `NaN`, so the HathorFederation contract wrapper has been carrying `chainId: NaN` since it was
  written, silently. The new name is required and must parse.

- **`HATHOR_INPUT_BLOCK_TTL` -> `HATHOR_INPUT_LOCK_TTL_MS`.** The value is handed straight to
  `setTimeout`, so it has always been milliseconds - but the shipped `.env.example` said `1`, one
  millisecond, which is no input lock at all. Renaming forces the value to be set deliberately
  instead of being inherited from an example that was wrong.

- **`multisigRequiredSignatures` / `HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES` ->
  `HATHOR_NUM_SIGNATURES`.** These were two names for one number, set from the same source in
  `docker-compose.yml` and read from different places in the code.

## Mapping

### EVM chain (was the `EVM_CONFIG` JSON blob)

| Old | New |
| --- | --- |
| `EVM_CONFIG.name` | `EVM_NAME` |
| `EVM_CONFIG.chainId` | `EVM_CHAIN_ID` |
| `EVM_CONFIG.host` | `EVM_HOST` |
| `EVM_CONFIG.bridge` | `EVM_BRIDGE_ADDRESS` |
| `EVM_CONFIG.federation` | `EVM_FEDERATION_ADDRESS` |
| `EVM_CONFIG.allowTokens` | `EVM_ALLOW_TOKENS_ADDRESS` |
| `EVM_CONFIG.fromBlock` | `EVM_FROM_BLOCK` |
| `EVM_CONFIG.blockTimeMs` | `EVM_BLOCK_TIME_MS` (optional, default `15000`) |
| `EVM_CONFIG.multiSig`, `.testToken`, `.multisigOrder` | removed - unused, or duplicated from Hathor config |

### State chain (was loose `process.env` reads)

| Old | New |
| --- | --- |
| `HATHOR_STATE_CONTRACT_HOST_URL` | `STATE_CHAIN_HOST` |
| `HATHOR_STATE_CONTRACT_ADDR` | `STATE_CONTRACT_ADDRESS` |
| `FEDERATION_CHAIN_ID` / `FEDERATION_CHAIN` | `STATE_CHAIN_ID` |
| `FEDERATION_FROM_BLOCK` | `STATE_FROM_BLOCK` |
| `FEDERATION_CONFIRMATION_BLOCKS` | `STATE_CONFIRMATION_BLOCKS` |

### Hathor (was the `HTR_CONFIG` JSON blob plus loose reads)

| Old | New |
| --- | --- |
| `HTR_CONFIG.name` | `HATHOR_NAME` |
| `HTR_CONFIG.chainId` | `HATHOR_CHAIN_ID` |
| `HTR_CONFIG.multisigOrder` | `HATHOR_MULTISIG_ORDER` |
| `HTR_CONFIG.minimumConfirmations` | `HATHOR_MIN_CONFIRMATIONS` |
| `HTR_CONFIG.multisigRequiredSignatures`, `HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES` | `HATHOR_NUM_SIGNATURES` |
| `HATHOR_INPUT_BLOCK_TTL` | `HATHOR_INPUT_LOCK_TTL_MS` (see above) |
| `HATHOR_LAST_TIMESTAMP` | `HATHOR_FROM_TIMESTAMP` |
| `HEADLESS_SERVER` | `HATHOR_FULLNODE_URL` |
| `HEADLESS_TX_MINING_URL` | `HATHOR_TX_MINING_URL` |
| `HEADLESS_NETWORK` | `HATHOR_NETWORK` |
| `HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS` | `HATHOR_MULTISIG_PUBKEYS` |
| `HEADLESS_SEED_DEFAULT` (was set on the wallet container) | `HATHOR_SEED` (now on the federator) |
| `WALLET_URL` / `HTR_CONFIG.walletUrl` | `HATHOR_HEADLESS_URL` - transitional only |
| `HEADLESS_API_KEY` / `HTR_CONFIG.walletKey` | `HATHOR_HEADLESS_API_KEY` - transitional only |
| `HTR_CONFIG.fromBlock` | removed - Hathor sync is address-based, never block-based |
| `HTR_CONFIG.eventQueueType`, `pubsubProjectId`, `RABBITMQ_URL` | removed with the queue |
| `HTR_CONFIG.singleWalletId`, `singleSeedKey`, `multisigWalletId`, `multisigSeedKey` | removed - headless wallet-id addressing |
| `HEADLESS_MULTISIG_SEED_DEFAULT_MAX_SIGNATURES` | removed - implied by the pubkey list length |
| — | `HATHOR_GAP_LIMIT` (new, optional, default `20`) |

### Federator identity and runtime

| Old | New |
| --- | --- |
| `FEDERATOR_KEY` | `FEDERATOR_KEY` (unchanged; `0x` prefix now optional) |
| `FEDERATOR_ADDRESS` | `FEDERATOR_ADDRESS` - now optional, and checked against the key rather than trusted |
| `config.storagePath` | `STORAGE_PATH` (default `./db`) |
| `config.endpointsPort` | `ENDPOINTS_PORT` (default `5000`) |
| `config.runEvery` (minutes) | `POLLING_INTERVAL_MS` (milliseconds - no unit conversion at the call site) |
| `config.federatorRetries` | `FEDERATOR_RETRIES` (default `3`) |
| `config.checkHttps` / `BRIDGE_SKIP_HTTPS` | `REQUIRE_HTTPS` (default `true`; one variable, not two with opposite senses) |
| `ETHERSCAN_KEY` | `ETHERSCAN_KEY` (unchanged, optional) |
| `config.explorer` | `EXPLORER_URL` (optional) |
| `config.runHeartbeatEvery` | removed - the heartbeat has been commented out in `main.ts` since before this work |

## Checks that run beyond the schema

`loadConfig` also rejects, with every problem reported in one pass:

- a `FEDERATOR_ADDRESS` that does not match the address derived from `FEDERATOR_KEY`;
- a `HATHOR_NUM_SIGNATURES` or `HATHOR_MULTISIG_ORDER` larger than the number of pubkeys
  (a quorum that could never be reached);
- a plaintext `EVM_HOST`, `STATE_CHAIN_HOST` or `HATHOR_FULLNODE_URL` while `REQUIRE_HTTPS` is on,
  unless it points at localhost;
- a half-configured headless pair (URL without key, or the reverse).
