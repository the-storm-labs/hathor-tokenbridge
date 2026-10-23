#!/usr/bin/env bash
# Moves this machine's federator from the legacy version (headless wallet + RabbitMQ) to the new
# one, in one command, and puts it back with another.
#
#   sudo ./migrate.sh              check everything, ask, switch
#   sudo ./migrate.sh --check      only check; changes nothing
#   sudo ./migrate.sh --rollback   go back to the legacy federator
#
# It reads the federator that is RUNNING, not your files: whatever .env name, folder or compose
# project you use, and whatever order your variables are in, it carries over exactly what the
# federator runs with today. Your .env and docker-compose.yml are never modified.
#
# Options: --image <image>  --federator <container name, if more than one runs here>  --yes
#          --set KEY=VALUE  (repeatable; only when the bridge maintainers tell you to)
set -euo pipefail

IMAGE=toggera/hathor-tokenbridge:8ef17d5c436527cfd563a2fe86afc79dc67debd9
HERE=$(cd "$(dirname "$0")" && pwd)
STATE_ROOT="$HERE/state"
HELPER_IMAGE=alpine:3.12
MODE=migrate YES=0 FEDERATOR="" SETS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --rollback) MODE=rollback ;;
    --yes) YES=1 ;;
    --image) IMAGE=${2:?--image needs a value}; shift ;;
    --federator) FEDERATOR=${2:?--federator needs a value}; shift ;;
    --set) SETS+=(--set "${2:?--set needs KEY=VALUE}"); shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
  shift
done

step() { printf '\n[%s] %s\n' "$1" "$2"; }
stop() { printf '\nSTOPPED: %s\n  What to do: %s\n' "$1" "$2" >&2; exit 2; }
kit() { python3 "$HERE/kit.py" "$@"; }

command -v docker >/dev/null || stop "docker is not installed here." "Run this on the machine where the federator runs."
command -v python3 >/dev/null || stop "python3 is not installed." "Install it (Ubuntu: sudo apt install python3) and run again."
docker ps >/dev/null 2>&1 || stop "this user cannot use docker." "Run it again with sudo: sudo ./migrate.sh"

# ------------------------------------------------------------------------------------- rollback

recreate() {  # docker create from saved args, then attach any further networks, then start
  local name=$1 image=$2 args_cmd=$3 line net aliases a
  local -a create_args nets alias_args list
  mapfile -t create_args < <(kit "$args_cmd" --state "$STATE_DIR" ${4:+--env "$4"} ${5:+--stamp "$5"})
  mapfile -t nets < <(kit networks --state "$STATE_DIR")
  docker create "${create_args[@]}" "$image" >/dev/null
  for line in "${nets[@]}"; do
    net=${line%%$'\t'*} aliases=${line#*$'\t'} alias_args=()
    IFS=, read -ra list <<< "$aliases"
    for a in "${list[@]}"; do alias_args+=(--alias "$a"); done
    docker network connect "${alias_args[@]}" "$net" "$name"
  done
  docker start "$name" >/dev/null
}

rollback() {
  STATE_DIR=$(readlink -f "${1:-$STATE_ROOT/latest}" 2>/dev/null || true)
  [ -n "$STATE_DIR" ] && [ -f "$STATE_DIR/state.env" ] || stop "there is no migration to undo." "Nothing to do."
  # shellcheck disable=SC1091
  . "$STATE_DIR/state.env"
  if [ "$(docker inspect -f '{{.Config.Image}}' "$FED" 2>/dev/null)" = "$OLD_IMAGE" ]; then
    echo "$FED already runs the legacy version ($OLD_IMAGE). Nothing to do."
    return 0
  fi
  step 1/3 "Stopping the new federator (kept as $FED-new-$STAMP for its logs)"
  if docker inspect "$FED" >/dev/null 2>&1; then
    docker stop -t 60 "$FED" >/dev/null || true
    docker update --restart no "$FED" >/dev/null || true
    docker rename "$FED" "$FED-new-$STAMP"
  fi
  step 2/3 "Restoring the Hathor position saved before the migration"
  if [ -f "$STATE_DIR/lastHathorTimestamp.txt" ] && docker inspect "$FED-new-$STAMP" >/dev/null 2>&1; then
    docker run --rm --volumes-from "$FED-new-$STAMP" -v "$STATE_DIR:/backup:ro" "$HELPER_IMAGE" \
      cp /backup/lastHathorTimestamp.txt /app/db/lastHathorTimestamp.txt
  fi
  step 3/3 "Recreating the legacy federator exactly as it was"
  recreate "$FED" "$OLD_IMAGE" legacy-args
  sleep 5
  docker ps --filter "name=^/$FED\$" --format '  {{.Names}}  {{.Image}}  {{.Status}}'
  printf '\nBACK ON THE LEGACY FEDERATOR. The new one is kept, stopped, as %s.\n' "$FED-new-$STAMP"
}

if [ "$MODE" = rollback ]; then rollback; exit 0; fi

# ---------------------------------------------------------------------------------------- check

step 1/6 "Finding the federator running on this machine"
DISCOVERY=$(kit discover ${FEDERATOR:+--federator "$FEDERATOR"}) || exit 2
eval "$DISCOVERY"
echo "  federator: $FED ($OLD_IMAGE)"
echo "  wallet:    $WALLET"
[ -n "$COMPOSE_DIR" ] && echo "  started from: $COMPOSE_DIR (compose project $COMPOSE_PROJECT)"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STATE="$STATE_ROOT/$STAMP"
mkdir -p "$STATE" && chmod 700 "$STATE_ROOT" "$STATE"
ENV_FILE="$STATE/.env.walletlib"

step 2/6 "Reading its configuration (secrets are not shown)"
kit env --federator "$FED" --wallet "$WALLET" --out "$ENV_FILE" "${SETS[@]}" || { rm -rf "$STATE"; exit 2; }

step 3/6 "Downloading the new version and checking the configuration with it"
if ! docker pull -q "$IMAGE" >/dev/null 2>&1; then
  docker image inspect "$IMAGE" >/dev/null 2>&1 || stop "could not download $IMAGE." "Check the machine's internet access and run again."
  echo "  (could not download it; using the copy already on this machine)"
fi
EXPECTED=$(kit expected --env "$ENV_FILE") || { rm -rf "$STATE"; exit 2; }
eval "$EXPECTED"
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$FED" | head -1)
if ! docker run --rm --env-file "$ENV_FILE" --network "$NET" \
    -e EXPECTED_MULTISIG="$EXPECTED_MULTISIG" -e EXPECTED_XPUBS="$EXPECTED_XPUBS" \
    -v "$HERE/preflight.js:/app/federator/built/federator/preflight.js:ro" \
    --entrypoint node "$IMAGE" preflight.js | sed 's/^/  /'; then
  rm -rf "$STATE"
  stop "the configuration check failed (see the FAIL lines above)." \
    "Send the FAIL lines to the bridge maintainers. Your federator was not touched."
fi

if [ "$MODE" = check ]; then
  rm -rf "$STATE"
  printf '\nCHECK PASSED. Nothing was changed. To migrate: sudo ./migrate.sh\n'
  exit 0
fi

if [ "$YES" != 1 ]; then
  printf '\nReady to switch %s to the new version. It stops for about a minute; the old one is kept\n' "$FED"
  printf 'and "sudo ./migrate.sh --rollback" brings it back in seconds.\n\nType yes to continue: '
  read -r answer
  [ "$answer" = yes ] || { rm -rf "$STATE"; echo "Not changed."; exit 0; }
fi

# --------------------------------------------------------------------------------------- switch

# Everything needed - including how to put the legacy federator back - is saved before it stops.
STATE_DIR=$STATE
kit save-legacy --federator "$FED" --state "$STATE"
printf 'FED=%s\nOLD_IMAGE=%s\nNEW_IMAGE=%s\nSTAMP=%s\n' "$FED" "$OLD_IMAGE" "$IMAGE" "$STAMP" > "$STATE/state.env"
docker run --rm --volumes-from "$FED" -v "$STATE:/backup" "$HELPER_IMAGE" \
  sh -c 'cp /app/db/lastHathorTimestamp.txt /backup/ 2>/dev/null; true'
ln -sfn "$STAMP" "$STATE_ROOT/latest"

step 4/6 "Stopping the legacy federator (its configuration is saved; --rollback recreates it)"
docker stop -t 60 "$FED" >/dev/null

step 5/6 "Carrying its progress over and starting the new federator"
docker run --rm --volumes-from "$FED" "$HELPER_IMAGE" sh -c '
  for f in /app/db/lastBlock_fhtr_*_31.txt; do [ -f "$f" ] && cp "$f" /app/db/cursor_evm-bridge.txt; done
  for f in /app/db/lastBlock_hmm_*_31.txt;  do [ -f "$f" ] && cp "$f" /app/db/cursor_hathor-federation.txt; done
  true'
# Removed, not kept: compose would start a kept legacy container again next to the new one. Its
# volumes stay, and the new federator takes its name, so a later "docker compose up" fails loudly.
docker rm "$FED" >/dev/null
recreate "$FED" "$IMAGE" new-args "$ENV_FILE" "$STAMP"

step 6/6 "Waiting for it to start (it rebuilds the wallet history; usually under 5 minutes)"
for _ in $(seq 1 90); do
  if [ "$(docker inspect -f '{{.RestartCount}}' "$FED")" -gt 3 ] || [ "$(docker inspect -f '{{.State.Status}}' "$FED")" = exited ]; then
    echo "  The new federator keeps failing:"; docker logs --tail 15 "$FED" 2>&1 | sed 's/^/    /'
    echo; echo "Going back to the legacy federator automatically."
    rollback "$STATE"
    exit 1
  fi
  if docker logs "$FED" 2>&1 | grep -q "Federator is running"; then
    printf '\nDONE. %s now runs %s.\n' "$FED" "$IMAGE"
    printf '  - To go back:  sudo ./migrate.sh --rollback\n'
    printf '  - From now on, do not use "docker compose up" for the federator. If you do, it fails with a\n'
    printf '    name conflict - that is expected and harmless: the new federator keeps running.\n'
    printf '    The headless wallet and RabbitMQ keep running; they are only needed for --rollback.\n'
    exit 0
  fi
  sleep 10
done
echo "  The new federator did not start within 15 minutes:"; docker logs --tail 15 "$FED" 2>&1 | sed 's/^/    /'
echo; echo "Going back to the legacy federator automatically."
rollback "$STATE"
exit 1
