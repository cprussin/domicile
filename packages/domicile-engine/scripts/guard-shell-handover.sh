#!/usr/bin/env bash
# The engine runs the shell and hands it the desktop, and nothing else on the
# page can find it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-handover.sh /build/chromium/src
#
# WHY THIS EXISTS. A shell is `Shell(root, domicile)`, called by the engine's
# DomicileShell with the body and a DomicileHost it made for the call -- so a
# shell keeps the desktop however it likes and no global holds a second copy.
# This page checks the three halves: it was called with the body, the desktop
# it was handed answers (its `windows` is a list), and neither
# `navigator.domicile` nor `window.domicile` exists. See
# packages/chrome-sdk/README.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-handover: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-shell-handover-broker}"
CONTROL="${CONTROL:-/tmp/domicile-shell-handover-control}"
PROFILE="${PROFILE:-/tmp/domicile-shell-handover-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shell-handover-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-shell-handover-socket.log}"
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
  annotate "guard-shell-handover: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-handover: no python3, and the compositor's end of the control socket is one"
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
# Any compositor that welcomes the channel will do: the windows guard's.
python3 "$SCRIPTS/guard-windows-state-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-shell-handover: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-handover.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
# No early exit when it never comes: the verdict below says why, with the
# engine's log.
wait_for_line "$TRIES" "GUARD handover " "$ENGINE_LOG"

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
HANDOVER=$(grep -oE '"GUARD handover [^"]*"' "$ENGINE_LOG" | head -1)
WANTED='"GUARD handover root=body desktop=yes navigator=none window=none"'

if [ -z "$HANDOVER" ]; then
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not find the module the document names, or did not call its Shell"
elif [ "$HANDOVER" = "$WANTED" ]; then
  FAILURE=""
else
  FAILURE="the shell was handed $HANDOVER where $WANTED was owed: called with the body and a desktop that answers, and no global holding one"
fi

echo "page: $HANDOVER"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-shell-handover: $FAILURE" "$ENGINE_LOG"
  echo "guard-shell-handover: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: the shell is handed the desktop, and nothing else finds it"
