#!/usr/bin/env bash
# Puts the legacy federator back exactly as it was before upgrade.sh. Run from the same directory:
#
#   ./rollback.sh
#
# Stops the wallet-lib container (kept, renamed <name>-walletlib-<stamp>, for its logs), restores the
# Hathor timestamp cursor to its pre-upgrade value - the one file both versions share - and starts
# the untouched legacy container again. The legacy EVM cursors were never written by the new
# version, so the legacy federator resumes from where it stopped; anything the new one handled in
# between is re-read and found already processed on chain. No image pull, no compose change.
set -euo pipefail

STATE_ROOT=${STATE_ROOT:-walletlib-upgrade}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.12}
STATE="$STATE_ROOT/latest"

die() { printf '\nABORT: %s\n' "$*" >&2; exit 1; }
[ -f "$STATE/state.env" ] || die "no upgrade state in $STATE"
# shellcheck disable=SC1091
. "$STATE/state.env"
STAMP=$(basename "$(readlink -f "$STATE")")

docker inspect "$NAME-legacy" >/dev/null 2>&1 || die "$NAME-legacy not found - nothing to roll back to"

echo "== stopping the wallet-lib federator $NAME"
if docker inspect "$NAME" >/dev/null 2>&1; then
  docker stop -t 60 "$NAME" >/dev/null
  docker update --restart no "$NAME" >/dev/null
  docker rename "$NAME" "$NAME-walletlib-$STAMP"
fi

echo "== restoring lastHathorTimestamp.txt to its pre-upgrade value"
if [ -f "$STATE/cursors/lastHathorTimestamp.txt" ]; then
  docker run --rm -v "$DB_VOLUME:/db" -v "$PWD/$STATE/cursors:/backup:ro" "$HELPER_IMAGE" \
    sh -c 'echo "  was $(cat /db/lastHathorTimestamp.txt), now $(cat /backup/lastHathorTimestamp.txt)"; cp /backup/lastHathorTimestamp.txt /db/lastHathorTimestamp.txt'
fi

echo "== starting the legacy federator ($OLD_IMAGE)"
docker rename "$NAME-legacy" "$NAME"
docker update --restart unless-stopped "$NAME" >/dev/null
docker start "$NAME" >/dev/null
sleep 5
docker ps --filter "name=^/$NAME\$" --format '{{.Names}}  {{.Image}}  {{.Status}}'
echo
echo "ROLLBACK DONE. The wallet-lib container is kept stopped as $NAME-walletlib-$STAMP."
