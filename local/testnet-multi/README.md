# 2-of-3 federator testnet: Arbitrum Sepolia + Hathor testnet

Three federators, each with its own EVM key and Hathor seed, share one 2-of-3 Hathor multisig. They
also share a `Federation.sol` and a `HathorFederation` with three members each. The contracts are
deployed fresh on Arbitrum Sepolia (421614), because production runs on Arbitrum One. Sepolia L1 has
a different block profile: ~12 s blocks instead of ~0.25 s, and confirmations counted in tens
instead of hundreds.

This environment exercises what a 1-of-1 setup cannot:
- a non-leader validating and signing a proposal someone else built;
- two federators racing to push the same proposal;
- the `order`-scaled confirmation delays;
- a federator going down.

## What is already here

| File | What it is | Secret? |
|---|---|---|
| `public.json` | The three federators' EVM addresses, the three xpubs and the multisig address | no |
| `fedN.identity.env` | Federator N's `FEDERATOR_KEY`, `HATHOR_SEED` and `HATHOR_MULTISIG_ORDER` | **yes**, gitignored |
| `shared.env.example` | Everything common to the three federators; copy it to `shared.env` | `shared.env` is, since the RPC URLs carry keys |
| `hathor-federation.params.example.json` | Ignition parameters for the coordination contract | no |
| `hathor-bootstrap.js` | Creates hUSDC, funds the multisig, and sends hUSDC back (the Hathor→EVM leg) | no |
| `docker-compose.yml` | The three federators, built from this checkout | no |

The identities were generated on 2026-09-21:
- Multisig: `wbihDnF11dfeMRVAWtE6b3MCCy9eSPoi5p`. All three seeds derive it through the same
  wallet-lib multisig config the federator uses.
- Single-sig wallet used for the bootstrap: `WSU3yq3f7r31JsiPHe1jPwE5zVv3BQCxnS`. This is federator
  #1's seed on the BIP44 path.

The `.identity.env` files exist only on the machine that generated them. Back them up before doing
anything else: they are testnet-only, but losing one strands whatever the multisig holds.

## Setup

### 1. What you have to supply

- **The deployer mnemonic**, as `bridge/mnemonic.key` and `../hathor-federation/mnemonic.key`. The
  deployer is index 0, and it owns everything through a 1-of-1 MultiSig.
- **An Infura project id**, as `infura.key` in both repos. Both networks build the Infura URL from it.
- **Arbitrum Sepolia ETH:**
  - on the deployer. It needs **more than 1.1 ETH of balance** only because
    `../hathor-federation/hardhat.config.js` pins `gasPrice: 160 gwei` with `gas: 6700000`: the
    balance has to cover gasLimit × gasPrice up front, even though Arbitrum only charges the base
    fee. Either fund it, or lower that gasPrice locally for the deploy.
  - a little on each of the three federator addresses in `public.json`. They pay for votes,
    proposals and signatures.
- **Testnet HTR**, just over 100 HTR, sent to `WSU3yq3f7r31JsiPHe1jPwE5zVv3BQCxnS`.

### 2. EVM contracts

From `bridge/`:

    npx hardhat deploy --network sepolia_arbitrum_multi --tags DeployFromScratch
    npx hardhat run ./hardhat/script/setupTestnetMulti.js --network sepolia_arbitrum_multi

`sepolia_arbitrum_multi` is the same chain as `sepolia_arbitrum`. It exists so that the deployments
land in `bridge/deployments/sepolia_arbitrum_multi/` instead of resolving to the 2024 1-of-1 set.

The setup script is idempotent. It:
1. deploys tUSDC, a `MainToken` with 6 decimals, like USDC;
2. allows tUSDC on AllowTokens as type 4 (`=1usd`: min 1, medium 10, large 100);
3. adds the three federators to the Federation;
4. removes the deployer from the Federation. The effective quorum is then `max(required, 3/2+1)` = 2.

From `../hathor-federation`, with the deployer address filled into a copy of the params file:

    npx hardhat ignition deploy ignition/modules/Federation.js --network arbitrum_sepolia \
      --parameters <path>/hathor-federation.params.json --deployment-id testnet-multi

**`--deployment-id` is required.** `ignition/deployments/chain-421614` already holds the earlier
deployment, and without its own id Ignition reports that one as "already deployed".

Both deploy steps were rehearsed end to end against a local `hardhat node` before any testnet ETH
was spent.

### 3. Hathor token

From this directory:

    NODE_PATH=../../federator/node_modules node hathor-bootstrap.js run

This creates hUSDC with its mint and melt authorities at the multisig, and sends 100 HTR to the
multisig for the 1% mint deposit. Then map the token on the bridge, from `bridge/`:

    HATHOR_TOKEN_UID=<uid> npx hardhat run ./hardhat/script/setupTestnetMulti.js --network sepolia_arbitrum_multi

Check that the multisig holds both authorities and the HTR. `address_balance` answers 403 on the
public node, but `address_history` works:
`https://node1.testnet.hathor.network/v1a/thin_wallet/address_history?addresses[]=wbihDnF11dfeMRVAWtE6b3MCCy9eSPoi5p`

### 4. Federators

Fill `shared.env` with the addresses and deploy blocks the scripts printed, then:

    docker compose up -d --build
    curl localhost:5001/status; curl localhost:5002/status; curl localhost:5003/status

Record how long each takes to report READY. The time to sync on first start is still an open number.

## Scenarios

Send tUSDC with `Bridge.receiveTokensTo(31, tUSDC, WSU3yq3f7r31JsiPHe1jPwE5zVv3BQCxnS, amount)`,
after `approve`. `WSU3yq3f7r31JsiPHe1jPwE5zVv3BQCxnS` is the single-sig wallet from step 3, so the
minted hUSDC lands where `hathor-bootstrap.js return` can send it back from.

| # | What | Pass when |
|---|---|---|
| 1 | EVM→Hathor: 5 tUSDC | #1 proposes, and #2 and #3 validate and sign. Exactly one mint of 500 hUSDC lands. `isProcessed` is true. No federator keeps retrying. |
| 2 | Hathor→EVM: `HUSDC_UID=<uid> node hathor-bootstrap.js return 500 <0xYourAddr>` | One melt. Two votes. `AcceptedCrossTransfer` for `5000000000000000000`. `claim()` returns the exact tUSDC. |
| 3 | #3 stopped, then 1 and 2 again | Both complete: #1 and #2 are a quorum on both sides. |
| 4 | #1 stopped, then a new transfer | It waits at "no proposal", which is expected because only order 1 proposes. Start #1 again: it resumes from its cursors and completes. |
| 5 | The push race, read across the three logs | Round 1: see how an "already spent" from a peer's push is handled. Round 2, after the error-wrapping fix: no `MANUAL_CHECK` for a transfer that settled, and no retries after `isProcessed`. |
| 6 | Restart one federator mid-flow | It resyncs. Record how long that takes. |

**Delays are expected.** Confirmations scale with `HATHOR_MULTISIG_ORDER`. For a small amount, 300
Arbitrum blocks is ~75 s for #1 and ~225 s for #3. On the Hathor side it is `minConfirmations × order`.
