# Moving a federator from the legacy image to the wallet-lib image

## For operators: one command

Copy this folder anywhere on the machine that runs your federator, then:

```sh
cd walletlib-migration
sudo ./migrate.sh --check     # checks everything; changes nothing
sudo ./migrate.sh             # checks again, asks you to type "yes", then switches
sudo ./migrate.sh --rollback  # back to the legacy federator, in seconds
```

You do not need to point it at your `.env`. It reads the federator's **container**, so it works
whatever your env file is called, wherever it is, whatever compose project name you use, and in
whatever order your variables are.

It also **switches your compose setup**, so nothing is left to do by hand afterwards: the usual
`docker compose up -d` / `down` in your federator folder run the new federator from then on, and
after `--rollback` they run the legacy one again. For that the federator must have been started
with that folder's default `docker-compose.yml` (no `-f`), and `docker-compose.walletlib.yml` must
be next to it - it is, in an up-to-date clone (`git pull`). Otherwise it stops and says so.

The container can be running or **stopped** (`docker compose stop`, `docker stop`): a stopped one
is read the same way, and the new federator is started at the end. It must still exist, though: if
it was removed (`docker compose down`), start it once the way you always did, then run this.

If something is missing or wrong it stops before touching anything, with a sentence saying what to
fix. If the new federator does not start, it goes back to the legacy one by itself.

After the switch the headless wallet and RabbitMQ keep running, only for `--rollback`. Compose
calls them "orphan containers"; do not use `--remove-orphans` until the bridge maintainers say so.

Options, only when the bridge maintainers tell you to:
- `--federator <name>`: more than one federator runs on this machine.
- `--set KEY=VALUE`: override one setting of the new federator (for example an `EVM_HOST`).
- `--yes`: do not ask before switching.

## What migrate.sh does

1. **Finds** the legacy federator among the containers (by its `HTR_CONFIG`/`EVM_CONFIG`
   environment, not by name), and its headless wallet (the `WALLET_URL` host on its networks).
   A running one wins; a stopped one is used only when none runs.
   It also checks the compose setup the switch needs (see above).
2. **Reads** both with `docker inspect` and writes `state/<timestamp>/.env.walletlib` (mode 600).
   No secret is printed. Missing `HATHOR_INPUT_BLOCK_TTL` falls back to 30 minutes and missing
   `HATHOR_LAST_TIMESTAMP` to the position the federator saved, or to now when it saved none (what
   the legacy federator did), each with a NOTE. Keys, seeds and addresses are never guessed.
3. **Checks** it from inside the new image (`preflight.js`) - the image pinned in
   `docker-compose.walletlib.yml`. The multisig and xpubs each federator must derive are built in
   for mainnet and the Arbitrum Sepolia testnet (`kit.py`, `FEDERATIONS`).
4. **Writes** it as `walletlib-fed<order>.env` next to `docker-compose.yml` (mode 600, owned like
   your `.env`, ignored by git as `**.env`) and has `docker compose config` accept the new file
   with it. Then it saves the legacy container's configuration (`legacy.json`, `legacy.env`) and the
   Hathor timestamp cursor, and stops the legacy federator.
5. **Copies** the cursors to the names the new code reads, adds one marked block to your `.env`:

       # >>> walletlib-migration: the federator runs the new version. ...
       COMPOSE_FILE=<folder>/docker-compose.walletlib.yml
       # <<< walletlib-migration

   and runs `docker compose up -d --no-deps hathor-federator`: compose replaces the legacy container
   with the new one (same name, port, volume). Nothing else in `.env` or `docker-compose.yml` changes.
6. **Waits** for "Federator is running", then starts the rest of the new file (monitoring); on a
   crash loop or after 15 minutes, rolls back.

`--rollback` saves the new federator's log to the state folder, stops it, restores the Hathor
timestamp cursor, removes the marked block from `.env` (and moves `walletlib-fed<order>.env` into the
state folder), and runs `docker compose up -d`: the legacy federator, its wallet and RabbitMQ come
back as compose defines them. A migration made by an earlier version of this kit is rolled back
the way that version did it (recreating the container from `legacy.json`).

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

## Rehearsed (2026-11-07, compose switch, `local/testnet-multi/legacy` fed3)

That folder is started with `-p legacy-fed3 --env-file fed3.env`, like `.rabbitmq/dockerone.sh`.

| Case | Result |
|---|---|
| Legacy running, migrate | Switched; `fed3.env` has the marked block; `walletlib-fed3.env` mode 600 |
| Operator's own `docker compose -p legacy-fed3 --env-file fed3.env up -d` afterwards | "Running": the new federator, nothing recreated |
| `--rollback` | Block removed, generated env moved to state, legacy recreated by compose |
| Whole stack stopped (`compose stop`), migrate | New federator and the other services of the new file up; wallet and RabbitMQ stay stopped |
| `--rollback` of that | Legacy federator, wallet and RabbitMQ all back up |
| Invalid YAML in the new compose file | Stops at `docker compose config`, before stopping anything |
| Started with `-f`, no compose, `.env` gone, no `docker-compose.walletlib.yml`, `COMPOSE_FILE` already set | Each stops in step 1 with a sentence (simulated labels) |

Not rehearsed here: the automatic rollback after a failed start of the compose-created federator.
