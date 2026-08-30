# Federator deployment

How to deploy it with Docker Compose

### Setup a Google Platform Project and APIs

There's a .env.example file here
- Remove the .example extension;
- You only have to change the variables with {CHANGE};
They are:
- HATHOR_MULTISIG_ORDER: this is the order your federator stands on the bridge. On a 4 federators configuration, it can be 1,2,3 or 4. You should agreed on that before hand;
- FEDERATOR_KEY: the private key (PK) to your EVM wallet. It will be used to sign the transactions on the EVM;
- ETHERSCAN_KEY: a ETHERSCAN key. The federator uses it to query the blockchain for the transactions. It can be a free account;
- EVM_HOST: add your INFURA key. This is the provider use to connect to the EVM and send transactions. It also can be a free account;
- FROM_BLOCK: the initial block the federator is going to start scanning when it's up. Unless you are instructed differently, it should be the most recent one;
- HEADLESS_SEED_DEFAULT: the Hathor Wallet seed;
- HEADLESS_API_KEY: this is your wallet key. It's best to generate a new uuid, so the comunication with the federator and wallet will be secured by it;
- HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS: this is the multisig pubkeys. The members of the multisig will exchange this information beforand

### Observability

By default (`docker-compose.yml`), metrics and logs are handled locally by `prometheus` +
`promtail`, same as before - no extra setup needed.

There's also an **optional** alternative, `docker-compose.alloy.yml`, which swaps those two for
a single Grafana Alloy agent shipping metrics+logs straight to Grafana Cloud (see
`alloy/config.alloy` for what each component does). Alloy is heavier on CPU/RAM than
prometheus+promtail, so this isn't the repo default and nobody needs to migrate to it - use it
only if you specifically want your federator's metrics/logs centralized in Grafana Cloud. To use
it, set the five `GRAFANA_CLOUD_*` variables in your `.env` (grab them from your Grafana Cloud
stack's "Connections" page - the Loki ones are a set of push credentials you may already have
from a previous promtail-based setup):
- GRAFANA_CLOUD_PROMETHEUS_URL / GRAFANA_CLOUD_PROMETHEUS_USER / GRAFANA_CLOUD_PROMETHEUS_API_KEY
  (Cloud Access Policy token scoped to `metrics:write`)
- GRAFANA_CLOUD_LOKI_URL / GRAFANA_CLOUD_LOKI_USER / GRAFANA_CLOUD_LOKI_API_KEY
  (Cloud Access Policy token scoped to `logs:write`)

### Deploy the containers

- Default (prometheus + promtail): `docker compose up -d`
- Alloy instead (see above): `docker compose -f docker-compose.alloy.yml up -d`

### The wallet-lib federator (opt-in)

`docker-compose.walletlib.yml` runs the same image against the rearchitected federator, which
embeds `@hathor/wallet-lib` instead of talking to a separate wallet container over HTTP. Three
containers disappear:

| | default stack | wallet-lib stack |
| --- | --- | --- |
| with prometheus + promtail | 6 containers | 3 |
| with alloy | 5 containers | 2 |

`rabbitmq` and `init-rabbitmq` are gone because the queue carried exactly one message type,
`wallet:new-tx`, across a process boundary that no longer exists. `hathor-wallet` is gone because
the wallet runs inside the federator.

The image builds both trees, so switching stacks - or rolling back - is a compose file, not a
rebuild:

    docker compose -f docker-compose.walletlib.yml --env-file <your.env> up -d       # or
    docker compose -f docker-compose.walletlib.alloy.yml --env-file <your.env> up -d

#### Three things to know before switching

**The multisig seed moves into the federator.** It used to hold only an API key for the wallet
container. This changes the blast radius of a federator compromise, and it is the one part of this
migration that alters the bridge's risk profile.

**Rename the block cursor files on the volume.** A name the new federator does not recognise reads
as "never ran", which means re-scanning the chain from `FROM_BLOCK`. On `hathor_federator_db_<n>`:

    lastBlock_fhtr_<mainChainId>_31.txt  ->  cursor_evm-bridge.txt
    lastBlock_hmm_<mainChainId>_31.txt   ->  cursor_hathor-federation.txt

`lastHathorTimestamp.txt` keeps its name and carries over untouched - it always sat on top of the
wallet's history rather than inside it.

**Restarting is expensive now.** Wallet storage is in memory, so every start rebuilds the entire
Hathor history - minutes, not seconds. The federator is built to absorb that: a reader failing is
logged, counted and retried rather than ending the process. Do not add a health check that
restarts on a slow start.

#### Rolling out gradually

Coordination is on-chain, so a federator on the new stack coexists with federators on the old one.
Two switches, in this order:

1. Set `HATHOR_HEADLESS_URL` and `HATHOR_HEADLESS_API_KEY` and keep the wallet container running
   from the old compose. The new federator then runs end to end against the wallet you already
   have, so the only thing being tested is the rewrite.
2. Unset them. The federator switches to the embedded library, and the wallet container can go.

`GET /status` on port `500<order>` reports which adapter is in use, the wallet's state, and each
scheduler's consecutive-failure count.

#### Configuration

The variable names changed - flat, validated values instead of two JSON blobs. The compose files
above map the existing `.env` names onto the new ones, so an existing `.env` works unchanged. The
full old -> new mapping, including what was removed and why, is in
`federator/app/config/CONFIG_MIGRATION.md`.

A missing or malformed variable now fails at boot, by name, instead of surfacing as `undefined`
somewhere downstream.
