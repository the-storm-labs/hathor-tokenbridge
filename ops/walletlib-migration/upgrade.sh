#!/usr/bin/env bash
# Switches one federator from the legacy (headless + RabbitMQ) image to the wallet-lib image.
# Run from the directory with the legacy docker-compose.yml and .env, after migrate-env.py:
#
#   EXPECTED_MULTISIG=<index-0 multisig address> EXPECTED_XPUBS=<xpub,xpub,...> \
#     ./upgrade.sh toggera/hathor-tokenbridge:<sha>
#
# PREFLIGHT_ONLY=1 runs step 1 and exits without touching anything.
#
# What it does, in order, stopping at the first problem:
#   1. preflight: pulls the image and runs preflight.js against .env.walletlib (nothing is stopped yet);
#   2. records the legacy container's image, mounts, network, port and the cursor files;
#   3. stops the legacy container and RENAMES it <name>-legacy - kept, not removed, so rollback.sh
#      only has to start it again;
#   4. copies (never renames) the legacy cursor files to the names the new federator reads;
#   5. starts the new container with the same name, mounts, network alias and port;
#   6. waits for "Federator is running".
# docker-compose.yml and .env are never modified. The two federators never run at the same time.
set -euo pipefail

IMAGE=${1:?usage: upgrade.sh <image>}
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${ENV_FILE:-.env.walletlib}
SERVICE=${SERVICE:-hathor-federator}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.12}
STATE_ROOT=${STATE_ROOT:-walletlib-upgrade}
: "${EXPECTED_MULTISIG:?set EXPECTED_MULTISIG}" "${EXPECTED_XPUBS:?set EXPECTED_XPUBS}"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nABORT: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found - run migrate-env.py first"
OLD_ID=$(docker compose ps -q "$SERVICE")
[ "$(printf '%s\n' "$OLD_ID" | grep -c .)" = 1 ] || die "expected exactly one running $SERVICE container"
NAME=$(docker inspect -f '{{.Name}}' "$OLD_ID" | sed 's#^/##')
docker inspect "$NAME-legacy" >/dev/null 2>&1 && die "$NAME-legacy already exists - an upgrade is already in place (rollback.sh first)"
OLD_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$OLD_ID")
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$OLD_ID" | head -1)
PORT=$(docker inspect -f '{{with index .HostConfig.PortBindings "5000/tcp"}}{{(index . 0).HostPort}}{{end}}' "$OLD_ID")
DB_VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/db"}}{{.Name}}{{end}}{{end}}' "$OLD_ID")
MOUNTS=$(docker inspect -f '{{range .Mounts}}{{.Name}}:{{.Destination}}{{"\n"}}{{end}}' "$OLD_ID")
[ -n "$DB_VOLUME" ] || die "no volume mounted at /app/db on $NAME"
[ -n "$PORT" ] || die "no host port mapped to 5000 on $NAME"

say "1/6 preflight ($IMAGE)"
docker pull -q "$IMAGE" >/dev/null
docker run --rm --env-file "$ENV_FILE" --network "$NET" \
  -e EXPECTED_MULTISIG -e EXPECTED_XPUBS ${PREFLIGHT_EXTRA_ENV:-} \
  -v "$HERE/preflight.js:/app/federator/built/federator/preflight.js:ro" \
  --entrypoint node "$IMAGE" preflight.js || die "preflight failed - nothing was changed"
if [ "${PREFLIGHT_ONLY:-0}" = 1 ]; then
  printf '\nPREFLIGHT_ONLY=1: stopping here, nothing was changed.\n'
  exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STATE="$STATE_ROOT/$STAMP"
say "2/6 recording state in $STATE"
mkdir -p "$STATE/cursors"
cat > "$STATE/state.env" <<EOF
NAME=$NAME
OLD_IMAGE=$OLD_IMAGE
NEW_IMAGE=$IMAGE
NET=$NET
PORT=$PORT
DB_VOLUME=$DB_VOLUME
EOF
printf '%s\n' "$MOUNTS" > "$STATE/mounts"
docker run --rm -v "$DB_VOLUME:/db:ro" -v "$PWD/$STATE/cursors:/out" "$HELPER_IMAGE" \
  sh -c 'cp /db/*.txt /out/ 2>/dev/null; ls /out'
ln -sfn "$STAMP" "$STATE_ROOT/latest"

say "3/6 stopping legacy $NAME (kept as $NAME-legacy)"
docker stop -t 60 "$NAME" >/dev/null
docker rename "$NAME" "$NAME-legacy"
# A stopped container keeps its restart policy; make sure a reboot cannot bring both back.
docker update --restart no "$NAME-legacy" >/dev/null

say "4/6 carrying the cursors over"
docker run --rm -v "$DB_VOLUME:/db" "$HELPER_IMAGE" sh -c '
  set -e
  for f in /db/lastBlock_fhtr_*_31.txt; do [ -f "$f" ] && cp "$f" /db/cursor_evm-bridge.txt; done
  for f in /db/lastBlock_hmm_*_31.txt;  do [ -f "$f" ] && cp "$f" /db/cursor_hathor-federation.txt; done
  for f in cursor_evm-bridge.txt cursor_hathor-federation.txt lastHathorTimestamp.txt; do
    echo "  $f = $(cat /db/$f 2>/dev/null || echo MISSING)"
  done'

say "5/6 starting $IMAGE as $NAME"
MOUNT_ARGS=()
while IFS= read -r mount; do [ -n "$mount" ] && MOUNT_ARGS+=(-v "$mount"); done < "$STATE/mounts"
docker run -d --name "$NAME" --restart unless-stopped \
  --env-file "$ENV_FILE" \
  --network "$NET" --network-alias "$SERVICE" \
  -p "$PORT:5000" "${MOUNT_ARGS[@]}" \
  --log-opt max-size=20m --log-opt max-file=5 --stop-timeout 60 \
  --label "walletlib-upgrade=$STAMP" \
  "$IMAGE" >/dev/null

say "6/6 waiting for the federator to come up (a cold start rebuilds the multisig history)"
for _ in $(seq 1 90); do
  if [ "$(docker inspect -f '{{.RestartCount}}' "$NAME")" -gt 3 ]; then
    docker logs --tail 30 "$NAME" 2>&1 | grep -E "ERROR|failed|Invalid" | tail -5
    die "$NAME keeps restarting - run ./rollback.sh"
  fi
  if docker logs "$NAME" 2>&1 | grep -q "Federator is running"; then
    docker logs "$NAME" 2>&1 | grep -E "Starting federator|wallet is ready|Federator is running" | tail -3
    printf '\nUPGRADE DONE. State: %s. To go back: ./rollback.sh\n' "$STATE"
    exit 0
  fi
  sleep 10
done
die "not running after 15 minutes - inspect 'docker logs $NAME', or ./rollback.sh"
