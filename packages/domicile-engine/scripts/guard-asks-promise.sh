#!/usr/bin/env bash
# `searchFiles()`, `previewFile()` and `searchApps()` resolve with the
# compositor's answer, and a newer ask rejects the one it supersedes.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-asks-promise.sh /build/chromium/src
#
# WHY THIS EXISTS. An ask used to be answered only by an event, and a shell
# needed `DomicileClient` to match the answer to the ask. The engine now does:
# it settles the ask the answer is for, and nothing else. The page asks for
# `old` and then `new` files, so `old` must reject with an AbortError; the
# stand-in answers `old` first anyway, which must not settle `new`. See
# docs/architecture/WINDOW-DOMICILE.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-asks-promise: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-asks-promise-broker}"
CONTROL="${CONTROL:-/tmp/domicile-asks-promise-control}"
PROFILE="${PROFILE:-/tmp/domicile-asks-promise-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-asks-promise-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-asks-promise-socket.log}"
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
  annotate "guard-asks-promise: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-asks-promise: no python3, and the compositor's end of the control socket is one"
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
python3 "$SCRIPTS/guard-asks-promise-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-asks-promise: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-asks-promise.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-asks-promise: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD asks " "$ENGINE_LOG"
sleep 1

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
ASKS=$(grep -oE '"GUARD asks [^"]*"' "$ENGINE_LOG" | head -1)
WANTED='"GUARD asks old=AbortError new=new.txt preview=text:hi notes.txt apps=Editor"'

if [ -z "$ASKS" ]; then
  FAILURE="the page never said how its asks settled, so the module did not run or an ask never settled"
elif [ "$ASKS" = "$WANTED" ]; then
  FAILURE=""
else
  FAILURE="the page's asks settled as $ASKS where $WANTED was owed: a superseded ask must reject, and each answer settle only the ask it answers"
fi

echo "page: $ASKS"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-asks-promise: $FAILURE" "$ENGINE_LOG"
  echo "guard-asks-promise: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: an ask settles with its own answer"
