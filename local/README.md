# Running the bridge on your machine

Both sides, locally, with the tokens production actually uses: USDC on Arbitrum and a Hathor custom
token standing in for its bridged form.

## The EVM side: anvil, forking Arbitrum One

    anvil --fork-url <arbitrum rpc> --fork-block-number <n> --port 8545 --hardfork shanghai

`--hardfork shanghai` is required. Without it every `eth_call` against a forked Arbitrum block fails
with "Excess blob gas not set".

Forking rather than deploying gets three things that cannot be built from this repo:

- **real USDC** at `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- the deployed **Bridge, Federation and AllowTokens**
- **HathorFederation**, whose source is not in this repository at all - only its ABI

Anvil then lets you impersonate the contract owners to rewire it: point USDC's Hathor mapping at
your local token with `addHathorToken`, and `addMember` your federator on both federations.

Anvil only mines when it receives a transaction, so the readers' confirmation depths are never
reached. Mine on a timer:

    while true; do cast rpc anvil_mine 0x1 --rpc-url http://127.0.0.1:8545; sleep 2; done

## The Hathor side

    MINER_ADDRESS=<your multisig address> docker compose -f local/docker-compose.yml up -d

Every non-obvious flag is commented in the compose file - the published `--localnet` preset does not
start as shipped, and transactions are rejected without `--fix-invalid-timestamp`.

**Set `HATHOR_PUSH_TIMEOUT_MS` high here** (30 minutes is comfortable). The wallet library does not
poll the miner on a fixed schedule: it asks again after half the mining time the tx-mining-service
estimates. That estimate is meaningless locally, because the service cannot measure a hashrate when
blocks are solved in a single hash, and it comes back in the hundreds of seconds for work that
finishes in three. Leave the production default in place and every push is abandoned before its
first status check. Nothing here makes the estimate honest - more miner threads do not help, since
the measured hashrate stays at zero.

## What this is for

The round trip: lock USDC on the fork, watch the federator mint on Hathor, send it back, watch it
melt and release. That is the one thing the contract suites cannot cover, because mint and melt need
the wallet to hold those authorities - which on a local network you simply create.
