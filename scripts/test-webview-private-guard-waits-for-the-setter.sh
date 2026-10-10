#!/usr/bin/env bash
# Tests that `guard-webview-private.sh` waits for the setter's `set-loaded` as
# well as the three reads before it measures.
#
# The setter reports `set-loaded` with a fetch of its own, and the readers
# start once its page commits, so on a busy machine all three reads can land
# first. A guard that stops at the third read then blames a setter that did
# load. Runs the wait loop from the real guard against a log where
# `set-loaded` comes last.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-private.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

LOOP="$(awk '/^TRIES=/,/^done$/' "$GUARD")"
[ -n "$LOOP" ] || {
  echo "no wait loop in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HTTP_LOG="$WORK/http.log"
ENGINE_LOG="$WORK/engine.log"
: >"$ENGINE_LOG"
printf '%s\n' "GUARD read as=window" "GUARD read as=normal" "GUARD read as=private" >"$HTTP_LOG"
(
  sleep 1
  echo "GUARD set-loaded" >>"$HTTP_LOG"
) &

FOR_SECONDS=5
eval "$LOOP"
# Read before the background writer is reaped: what the guard measures is
# what was in the log when its loop returned.
SET_WHEN_DONE=$(grep -cF "GUARD set-loaded" "$HTTP_LOG")
wait

if [ "$SET_WHEN_DONE" -ge 1 ]; then
  echo "  ok    the guard waits for the setter's report after the reads"
else
  echo "  FAIL  the guard stopped at the third read, before the setter reported" >&2
  exit 1
fi
