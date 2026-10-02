# Moving a federator from the legacy image to the wallet-lib image

For a federator running the legacy compose stack (`hathor-federator` + `hathor-wallet` + RabbitMQ).
Run everything from the directory with that `docker-compose.yml` and `.env`. Neither file is
modified, and the headless wallet and RabbitMQ are left running for the rollback.

```sh
# 0. Copy this directory next to docker-compose.yml.
# 1. Translate the configuration. Reads `docker compose config` and writes .env.walletlib (mode 600).
#    Secrets are never printed.
python3 walletlib-migration/migrate-env.py

# 2. Check it from inside the new image. Nothing is stopped.
export EXPECTED_MULTISIG=<multisig address at index 0> EXPECTED_XPUBS=<xpub,xpub,...>
PREFLIGHT_ONLY=1 walletlib-migration/upgrade.sh toggera/hathor-tokenbridge:<sha>

# 3. Switch.
walletlib-migration/upgrade.sh toggera/hathor-tokenbridge:<sha>

# Back to the legacy federator, in seconds:
walletlib-migration/rollback.sh
```

## What the switch does

- **upgrade.sh**
  - Stops the legacy container and renames it `<name>-legacy`. It is kept, with its restart policy off.
  - **Copies** the cursors to the names the new code reads:
    - `lastBlock_fhtr_*` -> `cursor_evm-bridge.txt`
    - `lastBlock_hmm_*` -> `cursor_hathor-federation.txt`
  - Starts the new image under the same name, volumes, port and network alias, so Alloy keeps
    scraping `hathor-federator:5000`.
  - The two federators never run at the same time.
- **rollback.sh**
  - Stops the new container and keeps it, renamed, for its logs.
  - Restores `lastHathorTimestamp.txt`, the one cursor both versions share, to its value before the switch.
  - Starts the legacy container again, untouched.
  - The legacy EVM cursors were never written by the new code, so the legacy federator re-reads
    whatever happened in between, and finds it already processed on chain.

State for each switch (image, mounts, port, cursor backup) is kept in `walletlib-upgrade/<timestamp>/`.

## Rehearsed

On the 2-of-3 Arbitrum Sepolia testnet, against a legacy federator (`local/testnet-multi/legacy`):
- migrate-env and preflight both passed;
- `upgrade.sh` had it running in about 10 s, and it signed an HTR transfer;
- `rollback.sh` took about 6 s, and the legacy federator signed the next transfer.
