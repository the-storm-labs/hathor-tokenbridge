# Moving a federator from the legacy image to the wallet-lib image

## For operators: one command

Copy this folder anywhere on the machine that runs your federator, then:

```sh
cd walletlib-migration
sudo ./migrate.sh --check     # checks everything; changes nothing
sudo ./migrate.sh             # checks again, asks you to type "yes", then switches
sudo ./migrate.sh --rollback  # back to the legacy federator, in seconds
```

You do not need to point it at your `.env`. It reads the federator that is **running**, so it works
whatever your env file is called, wherever it is, whatever compose project name you use, and in
whatever order your variables are. Your `.env` and `docker-compose.yml` are never changed.

If something is missing or wrong it stops before touching anything, with a sentence saying what to
fix. If the new federator does not start, it goes back to the legacy one by itself.

After the switch, **do not start the federator with `docker compose up` any more**. If you do, it
fails with a name conflict. That is expected and harmless: the new federator keeps running, and a
second federator never starts. The headless wallet and RabbitMQ keep running, for `--rollback`.

Options, only when the bridge maintainers tell you to:
- `--federator <name>`: more than one federator runs on this machine.
- `--set KEY=VALUE`: override one setting of the new federator (for example an `EVM_HOST`).
- `--image <image>`: a different version than the one this kit was released with.
- `--yes`: do not ask before switching.

## What migrate.sh does

1. **Finds** the legacy federator among the running containers (by its `HTR_CONFIG`/`EVM_CONFIG`
   environment, not by name), and its headless wallet (the `WALLET_URL` host on its networks).
2. **Reads** both with `docker inspect` and writes `state/<timestamp>/.env.walletlib` (mode 600).
   No secret is printed. Missing `HATHOR_INPUT_BLOCK_TTL` falls back to 30 minutes and missing
   `HATHOR_LAST_TIMESTAMP` to the position the federator saved, each with a NOTE. Keys, seeds and
   addresses are never guessed.
3. **Checks** it from inside the new image (`preflight.js`). The multisig and xpubs each federator
   must derive are built in for mainnet and the Arbitrum Sepolia testnet (`kit.py`, `FEDERATIONS`).
4. **Saves** the legacy container's whole configuration (`legacy.json`, `legacy.env`, mode 600) and
   the Hathor timestamp cursor, then stops it.
5. **Copies** the cursors to the names the new code reads, **removes** the legacy container (its
   volumes stay), and creates the new one under the same name, port, networks, aliases and volumes.
   Removed rather than kept stopped because `docker compose up` would start a kept container again,
   next to the new one.
6. **Waits** for "Federator is running"; on a crash loop or after 15 minutes, rolls back.

`--rollback` stops the new container (kept, renamed `<name>-new-<timestamp>`, for its logs),
restores the Hathor timestamp cursor, and recreates the legacy container from the saved
configuration, compose labels included, so compose owns it again.

## Rehearsed (2026-10-23, `local/testnet-multi/legacy`)

| Case | Result |
|---|---|
| Two legacy federators on one machine, no `--federator` | Stops: lists both, asks to pick one |
| Started with `docker compose -p legacy-fed2 --env-file fed2.env` | Found and migrated; ready in seconds |
| Env file renamed (`meu-federator.cfg`), variables shuffled, `HATHOR_INPUT_BLOCK_TTL` and `HATHOR_LAST_TIMESTAMP` removed, other project name | Migrated, with a NOTE for each fallback |
| Legacy RPC over `http://` (a proxy) | Stops in preflight; `--set EVM_HOST=https://...` fixes it |
| Typo in `--set` | Stops: "not a setting the new federator reads" |
| Migrated fed2 on a Hathor→EVM transfer | Signed the proposal, pushed the melt through wallet-lib |
| `docker compose up -d` after migrating | Fails on the name; no second federator |
| `--rollback`, twice | Legacy recreated as it was; the second run says there is nothing to do |
| New image crashes on start | Rolled back automatically |

## The earlier kit (migrate-env.py, upgrade.sh, rollback.sh)

Used for fed01 on 2026-10-02 and kept for its rollback. It needs the plain `.env` next to the
compose file and the default compose project, and it keeps the legacy container stopped as
`<name>-legacy` - which `docker compose up` would start again. Use `migrate.sh` for new migrations.
