#!/usr/bin/env python3
"""
Helper for migrate.sh. Reads the RUNNING legacy federator and its headless wallet with
`docker inspect`, so it does not matter how the operator started them: which .env file, which
compose project name, which directory, variables in any order, values typed straight into the
compose file. What the containers run with today is what gets carried over.

    kit.py discover [--federator NAME]          -> prints shell assignments for migrate.sh
    kit.py env --federator NAME --wallet NAME --out FILE
    kit.py expected --env FILE                  -> prints EXPECTED_MULTISIG / EXPECTED_XPUBS
    kit.py save-legacy --federator NAME --state DIR  -> legacy.json + legacy.env (mode 600)
    kit.py new-args --state DIR --env FILE --stamp S  -> `docker create` args for the new federator
    kit.py legacy-args --state DIR                     -> `docker create` args recreating the legacy one
    kit.py networks --state DIR                        -> its networks after the first, with aliases

No secret is ever printed. Every problem ends with a plain sentence saying what is missing and
where it usually lives, and exit status 2.
"""
import argparse
import json
import re
import shlex
import subprocess
import sys

# Public values of each federation: the multisig every federator of it must derive. Checked by
# preflight so a federator cannot be moved onto the wrong federation by a copy-paste mistake.
FEDERATIONS = {
    ("mainnet", "42161"): {
        "multisig": "hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD",
        "xpubs": [
            "xpub6CEnwhMDb9ScuKVA5yaG8WZHFiWAFoLYtBMP3XV4owTPDGRzRFNAYgkiubtFF1dK6Fn81pUXcXV9diTmMCukQ2xVtmaJYripYSNeNrF5pqx",
            "xpub6CCsYGzTUCPX65gQTYp9e1h6qXxcXgp8GR2KLngpGXAjtajubqfiSkHbcUP5kTZEA8MtV2mNtCLCtUH6waEmEiMbpgkXLKeyc8efNB6NMDx",
            "xpub6Cf8dZ18LHnB9nwp2RnEmG1wxmj8cMW13avCiM9xkeqpTybQH3BtRErBhbndL8vs4ENb7pmPqBhRGsWaA9agDR3KLiNPiSxBDhhS26465Bo",
            "xpub6BwPg7E1L3wBGbzMxbhJCTSjRYWwrbm6ZmmJeRFtBbfmqu8wkA7TFtWb6fPBpAVzEm4avdbCFwMtJemieMg77ynWBWUvRV4mAhaZJk6c9HQ",
            "xpub6CALNiW6nyqAeUWrj9MHWRQcmSpy1u47NGkNCDUixmjaq7EnJHcX7h8UfMNj5Ko3f7R5yNi52wJqiSmHUckA3ybK3EgnkLSXYpLfmdXj8WN",
            "xpub6BwjQxcrGLhsLnhJiQNxkBimCpUQfRAigFqaEoua72CNy2JQLbzfnPMg3DWoaRrz8ALHBp6GaM4yttC9gtW1yPA1ZyWgsWuJMThpwzG6vxm",
        ],
    },
    # The 2-of-3 Arbitrum Sepolia testnet (local/testnet-multi/public.json).
    ("testnet", "421614"): {
        "multisig": "wbihDnF11dfeMRVAWtE6b3MCCy9eSPoi5p",
        "xpubs": [
            "xpub6CqonxbmvMch8xZ4cnbprzyBiiFJtGc3E1JDme31HHMyXqqeH99yqrTpd15yv9nBM6ogJjSbSeTnydaJqTftjyM39AgaRPEbPfQG7kCA35f",
            "xpub6C426L9s6QfCwU7n65BQTLnUUoNG46XFmkQhFffYKnmo7niLQMTmhQ1vN228dNgZ6pbDRSAE2ePARZ9Qy1YenkFi2MCELjDg6ZxboSo6Eo1",
            "xpub6BuDjem7Tfe5idXhKBFYkq2gZuAMz4B9Gop3xpQrAk8FzchcHZ52FuGgTfaAPWdAmMjUmdWYhamy2nMmp5eWw8FbC2XvZxv18WZQ9hGKTvR",
        ],
    },
}

DEFAULT_TX_MINING = {
    "mainnet": "https://txmining.mainnet.hathor.network/",
    "testnet": "https://txmining.testnet.hathor.network/",
}
DEFAULT_INPUT_LOCK_TTL_MS = "1800000"
HELPER_IMAGE = "alpine:3.12"

# Where each value usually comes from in the legacy setup, for the error messages. The JSON fields
# are filled by compose from these .env names (see the legacy docker-compose.yml).
HTR_FIELDS = {"name": "HATHOR_NAME", "chainId": "HATHOR_CHAIN_ID", "multisigOrder": "HATHOR_MULTISIG_ORDER",
              "minimumConfirmations": "HATHOR_MINIMUM_CONFIRMATIONS"}
EVM_FIELDS = {"name": "EVM_NETWORK", "chainId": "EVM_CHAIN_ID", "host": "EVM_HOST", "bridge": "BRIDGE_ADDRESS",
              "federation": "FEDERATION_ADDRESS", "allowTokens": "ALLOW_TOKENS_ADDRESS", "fromBlock": "FROM_BLOCK"}


# Read by the new federator but not always present in what the legacy one carries over.
OPTIONAL_KEYS = {"FEDERATOR_ADDRESS", "ETHERSCAN_KEY", "HATHOR_LOOKBACK_BLOCKS", "HATHOR_AUTHORITY_POOL_TARGET"}


class Stop(Exception):
    def __init__(self, problem, todo):
        super().__init__(problem)
        self.problem, self.todo = problem, todo


def docker(*args):
    try:
        return subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout
    except FileNotFoundError:
        raise Stop("the docker command was not found.", "Run this on the machine where the federator runs.")
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or "").strip().splitlines()[-1:] or [""]
        if "permission denied" in detail[0].lower():
            raise Stop("this user is not allowed to use docker.", "Run it again with sudo: sudo ./migrate.sh")
        raise Stop(f"docker {args[0]} failed: {detail[0][:200]}", "Check that docker is running (docker ps).")


def inspect(*names):
    return json.loads(docker("inspect", *names))


def env_of(container):
    env = {}
    for item in container["Config"].get("Env") or []:
        key, _, value = item.partition("=")
        env[key] = value
    return env


def running():
    ids = docker("ps", "-q").split()
    return inspect(*ids) if ids else []


def name_of(container):
    return container["Name"].lstrip("/")


# ---------------------------------------------------------------------------------------- discover

def is_legacy_federator(c):
    env = env_of(c)
    return "HTR_CONFIG" in env and "EVM_CONFIG" in env


def is_walletlib_federator(c):
    env = env_of(c)
    return "HATHOR_SEED" in env and "EVM_HOST" in env


def is_headless_wallet(c):
    return "HEADLESS_SEED_DEFAULT" in env_of(c)


def networks_of(c):
    return c["NetworkSettings"].get("Networks") or {}


def find_wallet(federator, containers):
    """The headless wallet this federator talks to: the WALLET_URL host, resolved on its networks."""
    wallets = [c for c in containers if is_headless_wallet(c)]
    url = env_of(federator).get("WALLET_URL", "")
    host = re.sub(r"^\w+://", "", url).split("/")[0].split(":")[0]
    fed_nets = set(networks_of(federator))
    def reachable_as(c):
        names = {name_of(c)}
        for net, settings in networks_of(c).items():
            if net in fed_nets:
                names.update(settings.get("Aliases") or [])
        return names
    matches = [c for c in wallets if host and host in reachable_as(c)]
    if len(matches) == 1:
        return matches[0]
    same_net = [c for c in wallets if fed_nets & set(networks_of(c))]
    if len(same_net) == 1:
        return same_net[0]
    raise Stop(
        f"could not tell which headless wallet belongs to {name_of(federator)} "
        f"({len(wallets)} wallet container(s) running, WALLET_URL host '{host or '?'}').",
        "Make sure the hathor-wallet container of this federator is running (docker ps), then try again.")


def discover(args):
    containers = running()
    legacy = [c for c in containers if is_legacy_federator(c)]
    if args.federator:
        legacy = [c for c in legacy if name_of(c) == args.federator]
        if not legacy:
            names = ", ".join(name_of(c) for c in containers if is_legacy_federator(c)) or "none"
            raise Stop(f"no running legacy federator called {args.federator}.",
                       f"Legacy federators running here: {names}.")
    if not legacy:
        done = [name_of(c) for c in containers if is_walletlib_federator(c)]
        if done:
            raise Stop(f"this machine already runs the new federator ({', '.join(done)}); nothing to migrate.",
                       "If you meant to go back, run: sudo ./migrate.sh --rollback")
        raise Stop("no legacy federator is running on this machine.",
                   "Start it the way you always do (docker compose up -d), check it with docker ps, then try again.")
    if len(legacy) > 1:
        names = " ".join(name_of(c) for c in legacy)
        raise Stop(f"more than one legacy federator is running here: {names}.",
                   f"Choose one: sudo ./migrate.sh --federator <name>   (one of: {names})")
    fed = legacy[0]
    wallet = find_wallet(fed, containers)
    if not any(m.get("Destination") == "/app/db" for m in fed.get("Mounts") or []):
        raise Stop(f"{name_of(fed)} keeps no volume at /app/db, so its progress cannot be carried over.",
                   "Ask the bridge maintainers before migrating this federator.")
    if "5000/tcp" not in (fed["HostConfig"].get("PortBindings") or {}):
        print("NOTE: the federator publishes no host port for 5000; the new one will not either.", file=sys.stderr)
    labels = fed["Config"].get("Labels") or {}
    print(f"FED={shlex.quote(name_of(fed))}")
    print(f"WALLET={shlex.quote(name_of(wallet))}")
    print(f"OLD_IMAGE={shlex.quote(fed['Config']['Image'])}")
    print(f"COMPOSE_PROJECT={shlex.quote(labels.get('com.docker.compose.project', ''))}")
    print(f"COMPOSE_DIR={shlex.quote(labels.get('com.docker.compose.project.working_dir', ''))}")


# --------------------------------------------------------------------------------------------- env

def value(env, key, container, hint):
    v = env.get(key)
    if v is None or str(v).strip() == "":
        raise Stop(f"{key} is missing or empty in the {container} container.", hint)
    return str(v).strip()


def blob(env, key, fields, container):
    raw = env.get(key)
    if not raw:
        raise Stop(f"{key} is missing in the {container} container.",
                   "This does not look like a standard legacy federator; ask the bridge maintainers.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Compose fills these JSON blobs from .env; an empty number leaves e.g. "chainId":, behind.
        empty = [name for field, name in fields.items() if re.search(rf'"{field}":\s*[,}}]', raw)]
        where = f" Probably empty in your .env: {', '.join(empty)}." if empty else ""
        raise Stop(f"{key} in the {container} container is not valid JSON.{where}",
                   "Fill in the missing value in your .env, restart the federator, and try again.")
    for field, name in fields.items():
        if field in ("name",) and not data.get(field):
            continue
        if data.get(field) in (None, ""):
            raise Stop(f"{key}.{field} is empty in the {container} container.",
                       f"Set {name} in your .env, restart the federator, and try again.")
    return data


def pubkeys_of(raw):
    raw = raw.strip()
    keys = json.loads(raw) if raw.startswith("[") else [p.strip('"') for p in re.split(r"[\s,]+", raw)]
    keys = [k for k in keys if k]
    if not keys or not all(k.startswith("xpub") for k in keys):
        raise Stop("HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS in the wallet container is not a list of xpubs.",
                   "Compare it with the list the bridge maintainers sent you.")
    return ",".join(keys)


def cursor_timestamp(fed_name):
    out = docker("run", "--rm", "--volumes-from", fed_name, HELPER_IMAGE,
                 "sh", "-c", "cat /app/db/lastHathorTimestamp.txt 2>/dev/null || true").strip()
    return out if out.isdigit() else ""


def build_env(fed_name, wallet_name):
    fed_c, wal_c = inspect(fed_name, wallet_name)
    fed, wal = env_of(fed_c), env_of(wal_c)
    F, W = f"federator ({fed_name})", f"wallet ({wallet_name})"
    notes = []
    evm = blob(fed, "EVM_CONFIG", EVM_FIELDS, F)
    htr = blob(fed, "HTR_CONFIG", HTR_FIELDS, F)

    network = value(wal, "HEADLESS_NETWORK", W, "Set HEADLESS_NETWORK (mainnet or testnet) in your .env.")
    fullnode = value(wal, "HEADLESS_SERVER", W, "Set HEADLESS_SERVER (your Hathor full node URL) in your .env.")
    if "/v1a" not in fullnode:
        raise Stop("HEADLESS_SERVER does not contain /v1a.",
                   "Use the full node API base URL, e.g. https://node1.mainnet.hathor.network/v1a/")
    fullnode = fullnode if fullnode.endswith("/") else fullnode + "/"
    tx_mining = (wal.get("HEADLESS_TX_MINING_URL") or "").strip() or DEFAULT_TX_MINING.get(network)
    if not tx_mining:
        raise Stop(f"no tx-mining URL for network {network}.", "Set HEADLESS_TX_MINING_URL in your .env.")

    num_signatures = str(htr.get("multisigRequiredSignatures") or value(
        wal, "HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES", W, "Set it in your .env (mainnet: 4)."))

    ttl = (fed.get("HATHOR_INPUT_BLOCK_TTL") or "").strip()
    if not ttl.isdigit() or int(ttl) <= 0:
        notes.append(f"HATHOR_INPUT_BLOCK_TTL was not set; using {DEFAULT_INPUT_LOCK_TTL_MS} ms (30 minutes).")
        ttl = DEFAULT_INPUT_LOCK_TTL_MS

    from_ts = (fed.get("HATHOR_LAST_TIMESTAMP") or "").strip()
    if not from_ts.isdigit():
        from_ts = cursor_timestamp(fed_name)
        if not from_ts:
            raise Stop("HATHOR_LAST_TIMESTAMP is not set and the federator has no saved Hathor position.",
                       "Ask the bridge maintainers for the starting timestamp before migrating.")
        notes.append("HATHOR_LAST_TIMESTAMP was not set; using the position the federator saved.")

    seed_words = value(wal, "HEADLESS_SEED_DEFAULT", W, "The wallet seed (HEADLESS_SEED_DEFAULT) must be in your .env.").split()

    values = {
        "EVM_NAME": str(evm.get("name") or "arbitrum"),
        "EVM_CHAIN_ID": str(evm["chainId"]),
        "EVM_HOST": str(evm["host"]),
        "EVM_BRIDGE_ADDRESS": str(evm["bridge"]),
        "EVM_FEDERATION_ADDRESS": str(evm["federation"]),
        "EVM_ALLOW_TOKENS_ADDRESS": str(evm["allowTokens"]),
        "EVM_FROM_BLOCK": str(evm["fromBlock"]),
        "STATE_CHAIN_ID": value(fed, "FEDERATION_CHAIN_ID", F, "Set FEDERATION_CHAIN_ID in your .env (mainnet: 42161)."),
        "STATE_CHAIN_HOST": value(fed, "HATHOR_STATE_CONTRACT_HOST_URL", F, "Set HATHOR_STATE_CONTRACT_HOST_URL (an Arbitrum RPC URL) in your .env."),
        "STATE_CONTRACT_ADDRESS": value(fed, "HATHOR_STATE_CONTRACT_ADDR", F, "Set HATHOR_STATE_CONTRACT_ADDR in your .env."),
        "STATE_FROM_BLOCK": value(fed, "FEDERATION_FROM_BLOCK", F, "Set FEDERATION_FROM_BLOCK in your .env."),
        "STATE_CONFIRMATION_BLOCKS": value(fed, "FEDERATION_CONFIRMATION_BLOCKS", F, "Set FEDERATION_CONFIRMATION_BLOCKS in your .env."),
        "HATHOR_NAME": str(htr.get("name") or "hathor"),
        "HATHOR_CHAIN_ID": str(htr["chainId"]),
        "HATHOR_NETWORK": network,
        "HATHOR_FULLNODE_URL": fullnode,
        "HATHOR_TX_MINING_URL": tx_mining,
        "HATHOR_SEED": " ".join(seed_words),
        "HATHOR_MULTISIG_PUBKEYS": pubkeys_of(value(wal, "HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS", W,
                                                    "Set HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS in your .env.")),
        "HATHOR_NUM_SIGNATURES": num_signatures,
        "HATHOR_MULTISIG_ORDER": str(htr["multisigOrder"]),
        "HATHOR_MIN_CONFIRMATIONS": str(htr["minimumConfirmations"]),
        "HATHOR_INPUT_LOCK_TTL_MS": ttl,
        "HATHOR_FROM_TIMESTAMP": from_ts,
        "HATHOR_AUTHORITY_POOL_TARGET": "0",
        "FEDERATOR_KEY": value(fed, "FEDERATOR_KEY", F, "The federator's EVM private key (FEDERATOR_KEY) must be in your .env."),
        "STORAGE_PATH": "/app/db",
        "LOG_FILE": "/var/log/federator.log",
        "LOG_LEVEL": "debug",
        "ENDPOINTS_PORT": "5000",
    }
    # Optional: checked against the key when present, never required.
    if (fed.get("FEDERATOR_ADDRESS") or "").strip():
        values["FEDERATOR_ADDRESS"] = fed["FEDERATOR_ADDRESS"].strip()
    if (fed.get("ETHERSCAN_KEY") or "").strip():
        values["ETHERSCAN_KEY"] = fed["ETHERSCAN_KEY"].strip()
    for key, v in values.items():
        if any(c in v for c in "\n\r"):
            raise Stop(f"{key} contains a line break.", f"Remove the line break from {key} in your .env.")
    return values, notes


def shown(key, v):
    if key == "HATHOR_SEED":
        return f"<secret: {len(v.split())} words>"
    if key in ("FEDERATOR_KEY", "ETHERSCAN_KEY"):
        return "<secret: set>"
    if key == "HATHOR_MULTISIG_PUBKEYS":
        return f"<{len(v.split(','))} xpubs>"
    if key in ("EVM_HOST", "STATE_CHAIN_HOST", "HATHOR_FULLNODE_URL"):
        scheme, _, rest = v.partition("://")
        return f"{scheme}://{rest.split('/')[0]}/<path hidden>"
    return v


def write_env(args):
    values, notes = build_env(args.federator, args.wallet)
    # --set KEY=VALUE, given by the bridge maintainers for a setup only they know how to fix (an
    # http RPC, a different full node). Only keys the federator reads, so a typo cannot slip by.
    for item in args.set or []:
        key, sep, v = item.partition("=")
        if not sep or key not in values and key not in OPTIONAL_KEYS:
            raise Stop(f"--set {key or item}: not a setting the new federator reads.",
                       "Check the spelling with the bridge maintainers.")
        values[key] = v.strip()
        notes.append(f"{key} set by --set.")
    import os
    fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write("# Generated by migrate.sh from the running legacy federator. Contains secrets.\n")
        for key, v in values.items():
            # `docker --env-file` takes the rest of the line verbatim: no quotes, no escaping.
            handle.write(f"{key}={v}\n")
    width = max(len(k) for k in values)
    for key, v in values.items():
        print(f"    {key.ljust(width)}  {shown(key, v)}")
    for note in notes:
        print(f"  NOTE: {note}")


# ------------------------------------------------------------------------------ expected / run-args

def read_env_file(path):
    values = {}
    with open(path) as handle:
        for line in handle:
            if "=" in line and not line.startswith("#"):
                key, _, v = line.rstrip("\n").partition("=")
                values[key] = v
    return values


def expected(args):
    env = read_env_file(args.env)
    fed = FEDERATIONS.get((env.get("HATHOR_NETWORK"), env.get("EVM_CHAIN_ID")))
    if not fed:
        raise Stop(f"unknown federation (Hathor {env.get('HATHOR_NETWORK')}, EVM chain {env.get('EVM_CHAIN_ID')}).",
                   "Export EXPECTED_MULTISIG and EXPECTED_XPUBS (from the bridge maintainers) and run again.")
    print(f"EXPECTED_MULTISIG={shlex.quote(fed['multisig'])}")
    print(f"EXPECTED_XPUBS={shlex.quote(','.join(fed['xpubs']))}")


# The legacy container is REMOVED during the switch, not kept stopped: `docker compose up`
# recognises a kept container by its labels and starts it again - a second federator signing with
# the same key. Removed, a compose up fails on the name the new federator now holds. Everything
# needed to recreate it exactly (including those labels, so compose owns it again) is saved first.

def save_legacy(args):
    import os
    c = inspect(args.federator)[0]
    # The inspect output carries the legacy environment, secrets included: owner-only, like the rest.
    fd = os.open(os.path.join(args.state, "legacy.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(c, handle)
    fd = os.open(os.path.join(args.state, "legacy.env"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        for item in c["Config"].get("Env") or []:
            if "\n" in item:
                raise Stop("a variable of the legacy federator contains a line break.",
                           "Ask the bridge maintainers before migrating this federator.")
            handle.write(item + "\n")


def saved(state):
    import os
    with open(os.path.join(state, "legacy.json")) as handle:
        return json.load(handle)


def mount_args(c):
    out = []
    for m in c.get("Mounts") or []:
        source = m.get("Name") if m.get("Type") == "volume" else m.get("Source")
        if not source:
            continue
        out += ["-v", f"{source}:{m['Destination']}{'' if m.get('RW', True) else ':ro'}"]
    return out


def common_args(c):
    out = []
    for binding in (c["HostConfig"].get("PortBindings") or {}).get("5000/tcp") or []:
        host_ip, host_port = binding.get("HostIp") or "", binding.get("HostPort") or ""
        out += ["-p", f"{host_ip + ':' if host_ip else ''}{host_port}:5000"]
    log = c["HostConfig"].get("LogConfig") or {}
    if log.get("Type"):
        out += ["--log-driver", log["Type"]]
        for k, v in (log.get("Config") or {}).items():
            out += ["--log-opt", f"{k}={v}"]
    nets = list(networks_of(c))
    if nets:
        out += ["--network", nets[0]]
        for alias in aliases(c, nets[0]):
            out += ["--network-alias", alias]
    return out + mount_args(c)


def new_args(args):
    """`docker create` arguments that put the new federator exactly where the legacy one was."""
    c = saved(args.state)
    out = ["--name", name_of(c), "--restart", "unless-stopped", "--env-file", args.env,
           "--stop-timeout", "60", "--label", f"walletlib-migration={args.stamp}"]
    print("\n".join(out + common_args(c)))


def legacy_args(args):
    """`docker create` arguments recreating the legacy federator as it was, compose labels included."""
    import os
    c = saved(args.state)
    restart = (c["HostConfig"].get("RestartPolicy") or {}).get("Name") or "no"
    out = ["--name", name_of(c), "--restart", restart, "--env-file", os.path.join(args.state, "legacy.env")]
    for k, v in (c["Config"].get("Labels") or {}).items():
        out += ["--label", f"{k}={v}"]
    print("\n".join(out + common_args(c)))


def aliases(c, net):
    """The names others reach this federator by on `net` (Alloy scrapes hathor-federator:5000)."""
    keep = set()
    for alias in (networks_of(c)[net].get("Aliases") or []):
        # Docker adds the container name and short id itself; only user-facing aliases carry over.
        if alias != name_of(c) and not re.fullmatch(r"[0-9a-f]{12}", alias):
            keep.add(alias)
    keep.add("hathor-federator")
    return sorted(keep)


def networks(args):
    c = saved(args.state)
    for net in list(networks_of(c))[1:]:
        print(net + "\t" + ",".join(aliases(c, net)))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("discover"); p.add_argument("--federator")
    p = sub.add_parser("env"); p.add_argument("--federator", required=True); p.add_argument("--wallet", required=True); p.add_argument("--out", required=True)
    p.add_argument("--set", action="append")
    p = sub.add_parser("expected"); p.add_argument("--env", required=True)
    p = sub.add_parser("save-legacy"); p.add_argument("--federator", required=True); p.add_argument("--state", required=True)
    p = sub.add_parser("new-args"); p.add_argument("--state", required=True); p.add_argument("--env", required=True); p.add_argument("--stamp", required=True)
    p = sub.add_parser("legacy-args"); p.add_argument("--state", required=True)
    p = sub.add_parser("networks"); p.add_argument("--state", required=True)
    args = parser.parse_args()
    try:
        {"discover": discover, "env": write_env, "expected": expected, "save-legacy": save_legacy,
         "new-args": new_args, "legacy-args": legacy_args, "networks": networks}[args.cmd](args)
    except Stop as stop:
        print(f"\nSTOPPED: {stop.problem}\n  What to do: {stop.todo}\n  Nothing was changed.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
