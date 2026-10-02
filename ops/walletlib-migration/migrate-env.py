#!/usr/bin/env python3
"""
Writes .env.walletlib for the wallet-lib federator from the configuration the legacy federator
runs with today. Run it from the directory that holds the legacy docker-compose.yml and .env.

    python3 migrate-env.py [--out .env.walletlib]

The source is `docker compose config`: the values compose actually hands the running containers,
after .env interpolation and quoting - not a re-parse of .env, which could disagree with compose on
quotes or spaces in the seed. Nothing is changed in place: .env and docker-compose.yml stay exactly
as they are, which is what makes the rollback a plain `docker compose up`.

No secret is printed. Secrets are reported as present/absent (and the seed by word count); public
values (addresses, chain ids, blocks) are shown so the mapping can be reviewed. The output file is
created with mode 600. The mapping follows federator/src/config/CONFIG_MIGRATION.md.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

FEDERATOR_SERVICE = "hathor-federator"
WALLET_SERVICE = "hathor-wallet"
DEFAULT_TX_MINING = {
    "mainnet": "https://txmining.mainnet.hathor.network/",
    "testnet": "https://txmining.testnet.hathor.network/",
}
SECRET = {"HATHOR_SEED", "FEDERATOR_KEY", "ETHERSCAN_KEY"}
OPTIONAL = {"ETHERSCAN_KEY"}
# URLs may carry an API token in their path; only the scheme and host are shown.
URL = {"EVM_HOST", "STATE_CHAIN_HOST", "HATHOR_FULLNODE_URL"}


def fail(message):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def compose_environment():
    try:
        raw = subprocess.run(
            ["docker", "compose", "config", "--format", "json"],
            check=True, capture_output=True, text=True,
        ).stdout
    except subprocess.CalledProcessError as error:
        # stderr from compose names a problem in the file, never a value; still, keep it short.
        fail(f"docker compose config failed: {error.stderr.strip()[:300]}")
    services = json.loads(raw).get("services", {})
    for name in (FEDERATOR_SERVICE, WALLET_SERVICE):
        if name not in services:
            fail(f"service {name} not found in docker-compose.yml")
    return services[FEDERATOR_SERVICE].get("environment") or {}, services[WALLET_SERVICE].get("environment") or {}


def required(env, key, where):
    value = env.get(key)
    if value is None or str(value).strip() == "":
        fail(f"{key} is empty in the {where} service environment")
    return str(value).strip()


def blob(env, key):
    try:
        return json.loads(required(env, key, FEDERATOR_SERVICE))
    except json.JSONDecodeError as error:
        fail(f"{key} is not valid JSON ({error.msg} at position {error.pos})")


def pubkeys_of(value):
    # The headless wallet takes them space-separated (that is what production has); JSON arrays and
    # commas are accepted too. The wallet-lib federator wants them comma-separated.
    value = value.strip()
    if value.startswith("["):
        keys = json.loads(value)
    else:
        keys = [part.strip('"') for part in re.split(r"[\s,]+", value)]
    keys = [key for key in keys if key]
    if not keys or not all(key.startswith("xpub") for key in keys):
        fail("HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS does not look like a list of xpubs")
    return ",".join(keys)


def build():
    fed, wallet = compose_environment()
    evm = blob(fed, "EVM_CONFIG")
    htr = blob(fed, "HTR_CONFIG")

    network = required(wallet, "HEADLESS_NETWORK", WALLET_SERVICE)
    fullnode = required(wallet, "HEADLESS_SERVER", WALLET_SERVICE)
    if "/v1a" not in fullnode:
        fail("HEADLESS_SERVER does not contain /v1a; wallet-lib needs the full API base URL")
    if not fullnode.endswith("/"):
        fullnode += "/"
    tx_mining = (wallet.get("HEADLESS_TX_MINING_URL") or "").strip() or DEFAULT_TX_MINING.get(network)
    if not tx_mining:
        fail(f"no HEADLESS_TX_MINING_URL and no default for network {network}")

    num_signatures = str(htr.get("multisigRequiredSignatures") or required(wallet, "HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES", WALLET_SERVICE))

    return {
        # EVM chain (was EVM_CONFIG)
        "EVM_NAME": str(evm["name"]),
        "EVM_CHAIN_ID": str(evm["chainId"]),
        "EVM_HOST": str(evm["host"]),
        "EVM_BRIDGE_ADDRESS": str(evm["bridge"]),
        "EVM_FEDERATION_ADDRESS": str(evm["federation"]),
        "EVM_ALLOW_TOKENS_ADDRESS": str(evm["allowTokens"]),
        "EVM_FROM_BLOCK": str(evm["fromBlock"]),
        # State chain (was loose env)
        "STATE_CHAIN_ID": required(fed, "FEDERATION_CHAIN_ID", FEDERATOR_SERVICE),
        "STATE_CHAIN_HOST": required(fed, "HATHOR_STATE_CONTRACT_HOST_URL", FEDERATOR_SERVICE),
        "STATE_CONTRACT_ADDRESS": required(fed, "HATHOR_STATE_CONTRACT_ADDR", FEDERATOR_SERVICE),
        "STATE_FROM_BLOCK": required(fed, "FEDERATION_FROM_BLOCK", FEDERATOR_SERVICE),
        "STATE_CONFIRMATION_BLOCKS": required(fed, "FEDERATION_CONFIRMATION_BLOCKS", FEDERATOR_SERVICE),
        # Hathor (was HTR_CONFIG, the headless wallet's env, and loose env)
        "HATHOR_NAME": str(htr["name"]),
        "HATHOR_CHAIN_ID": str(htr["chainId"]),
        "HATHOR_NETWORK": network,
        "HATHOR_FULLNODE_URL": fullnode,
        "HATHOR_TX_MINING_URL": tx_mining,
        "HATHOR_SEED": " ".join(required(wallet, "HEADLESS_SEED_DEFAULT", WALLET_SERVICE).split()),
        "HATHOR_MULTISIG_PUBKEYS": pubkeys_of(required(wallet, "HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS", WALLET_SERVICE)),
        "HATHOR_NUM_SIGNATURES": num_signatures,
        "HATHOR_MULTISIG_ORDER": str(htr["multisigOrder"]),
        "HATHOR_MIN_CONFIRMATIONS": str(htr["minimumConfirmations"]),
        "HATHOR_INPUT_LOCK_TTL_MS": required(fed, "HATHOR_INPUT_BLOCK_TTL", FEDERATOR_SERVICE),
        "HATHOR_FROM_TIMESTAMP": required(fed, "HATHOR_LAST_TIMESTAMP", FEDERATOR_SERVICE),
        # Off: the change is the federator, not the authority pool.
        "HATHOR_AUTHORITY_POOL_TARGET": "0",
        # Identity
        "FEDERATOR_KEY": required(fed, "FEDERATOR_KEY", FEDERATOR_SERVICE),
        "FEDERATOR_ADDRESS": required(fed, "FEDERATOR_ADDRESS", FEDERATOR_SERVICE),
        "ETHERSCAN_KEY": str(fed.get("ETHERSCAN_KEY") or ""),
        # Runtime: the same volume paths the legacy container uses, so the cursors are found.
        "STORAGE_PATH": "/app/db",
        "LOG_FILE": "/var/log/federator.log",
        "LOG_LEVEL": "debug",
        "ENDPOINTS_PORT": "5000",
    }


def shown(key, value):
    if key == "HATHOR_SEED":
        return f"<secret: {len(value.split())} words>"
    if key in SECRET:
        return "<secret: set>" if value else "<empty>"
    if key == "HATHOR_MULTISIG_PUBKEYS":
        return f"<{len(value.split(','))} xpubs>"
    if key in URL:
        scheme, _, rest = value.partition("://")
        return f"{scheme}://{rest.split('/')[0]}/<path hidden>"
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=".env.walletlib")
    args = parser.parse_args()

    if os.path.exists(args.out):
        fail(f"{args.out} already exists; move it away first (this script never overwrites)")

    values = build()
    # Optional variables must be absent rather than empty: the schema rejects "ETHERSCAN_KEY=".
    for key in OPTIONAL:
        if not values.get(key):
            values.pop(key, None)
    for key, value in values.items():
        # compose's env_file would interpolate "$", cut at " #" and strip quotes: refuse rather than
        # write a value that compose would read back differently.
        if any(c in value for c in "\n\r$") or " #" in value or (value and value[0] in "\"'"):
            fail(f"{key} contains a character env_file would not keep verbatim ($, ' #', quote or newline)")

    directory = os.path.dirname(os.path.abspath(args.out))
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=".env.walletlib.")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write("# Generated by migrate-env.py from the legacy federator's compose config.\n")
            for key, value in values.items():
                # docker --env-file takes the rest of the line verbatim: no quotes, no escaping.
                handle.write(f"{key}={value}\n")
        os.rename(temporary, args.out)
    except BaseException:
        os.unlink(temporary)
        raise

    print(f"Wrote {args.out} (mode 600):")
    width = max(len(key) for key in values)
    for key, value in values.items():
        print(f"  {key.ljust(width)}  {shown(key, value)}")


if __name__ == "__main__":
    main()
