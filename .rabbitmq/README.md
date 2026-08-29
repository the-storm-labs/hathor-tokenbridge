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