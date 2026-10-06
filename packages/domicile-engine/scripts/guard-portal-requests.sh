#!/usr/bin/env bash
# A shell that listens late for `portalrequests` still hears them, its answer
# reaches the compositor, and a malformed answer does not.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-portal-requests.sh /build/chromium/src
#
# The engine keeps the latest `portal_requests` line and sends it again to a
# listener added later. The stand-in pushes one request on connect; the page
# listens only after it has arrived, so only that replay reaches it. See
# docs/architecture/PORTALS.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-portal-requests: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-portal-requests-broker}"
CONTROL="${CONTROL:-/tmp/domicile-portal-requests-control}"
PROFILE="${PROFILE:-/tmp/domicile-portal-requests-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-portal-requests-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-portal-requests-socket.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-portal-requests: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-portal-requests: no python3, and the compositor's end of the control socket is one"
  exit 77
}

rm -f "$BROKER" "$CONTROL"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-portal-requests-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-portal-requests: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-portal-requests.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-portal-requests: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD portal " "$ENGINE_LOG"
wait_for_line 20 "answered: " "$SOCKET_LOG"
sleep 1

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
PORTAL=$(grep -oE '"GUARD portal [^"]*"' "$ENGINE_LOG" | head -1)
WANTED="\"GUARD portal heard=1:access:org.example.App\""
ANSWERS=$(grep '^answered: ' "$SOCKET_LOG")
WANTED_ANSWERS='answered: 1 {"kind": "access"}'

if [ -z "$PORTAL" ]; then
  FAILURE="the page never said what it heard, so the module did not run, or the requests never reached a late listener"
elif [ "$PORTAL" != "$WANTED" ]; then
  FAILURE="the page said $PORTAL where $WANTED was owed"
elif [ "$ANSWERS" != "$WANTED_ANSWERS" ]; then
  FAILURE="the stand-in heard [$ANSWERS] where only [$WANTED_ANSWERS] was owed: the answer must arrive, and the one without a kind must not"
else
  FAILURE=""
fi

echo "page: $PORTAL"
echo "stand-in: $ANSWERS"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-portal-requests: $FAILURE" "$ENGINE_LOG"
  echo "guard-portal-requests: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a late listener hears the portal requests, and only a well-formed answer reaches the compositor"
