#!/usr/bin/env bash
# A `focusrequested` the compositor sends before the shell listens reaches the
# shell's first listener.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-held-moments.sh /build/chromium/src
#
# WHY THIS EXISTS. A moment has no attribute to read late: a focus request, an
# address to open or a pressed shortcut dispatched to nobody is gone. The engine
# holds one that arrives before anything listens for its type, and hands it to
# the first listener -- the rule that replaces `DomicileClient`'s buffer. The
# stand-in asks for focus on `first` before the page listens, and on `second`
# after; the page must hear both, in order, once each, and neither inside its
# own `addEventListener` call. See docs/architecture/WINDOW-DOMICILE.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-held-moments: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-held-moments-broker}"
CONTROL="${CONTROL:-/tmp/domicile-held-moments-control}"
PROFILE="${PROFILE:-/tmp/domicile-held-moments-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-held-moments-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-held-moments-socket.log}"
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
  annotate "guard-held-moments: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-held-moments: no python3, and the compositor's end of the control socket is one"
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
python3 "$SCRIPTS/guard-held-moments-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-held-moments: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-held-moments.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-held-moments: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD heard " "$ENGINE_LOG"
sleep 1

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
HEARD=$(grep -oE '"GUARD heard [^"]*"' "$ENGINE_LOG" | head -1)

if [ -z "$HEARD" ]; then
  FAILURE="the page never said what it heard, so the module did not run or threw"
elif [ "$HEARD" = '"GUARD heard first,second sync=0"' ]; then
  FAILURE=""
elif [ "$HEARD" = '"GUARD heard second sync=0"' ]; then
  FAILURE="the request for first, sent before anything listened, never reached the listener added later: the engine dispatched it to no one"
else
  FAILURE="the page heard $HEARD where the compositor asked for first, then second, before the listener and after it, each once and none inside addEventListener"
fi

echo "page: $HEARD"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-held-moments: $FAILURE" "$ENGINE_LOG"
  echo "guard-held-moments: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a moment that arrives before its listener waits for it"
