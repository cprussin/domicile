#!/usr/bin/env bash
# `grabShortcut("Meta+Shift+l")` is resolved by the engine, its press comes
# back as a `shortcut` whose `chord` is that string, and letting go of Shift
# comes back as a `shortcutrelease` with the same chord.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shortcut-chords.sh /build/chromium/src
#
# WHY THIS EXISTS. A shell used to resolve its own chords against the keymap
# `shell_config` carried, and to answer a press on its own page apart from one
# in a `<webview>`. The engine does both now. The stand-in describes a keyboard
# with `l` on evdev 38 and later presses Meta+Shift+l itself; the page grabs a
# chord written wrong, one the keyboard cannot type and Meta+Shift+l, and
# presses keys on itself. See docs/architecture/WINDOW-DOMICILE.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shortcut-chords: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-shortcut-chords-broker}"
CONTROL="${CONTROL:-/tmp/domicile-shortcut-chords-control}"
PROFILE="${PROFILE:-/tmp/domicile-shortcut-chords-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shortcut-chords-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-shortcut-chords-socket.log}"
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
  annotate "guard-shortcut-chords: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shortcut-chords: no python3, and the compositor's end of the control socket is one"
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
python3 "$SCRIPTS/guard-shortcut-chords-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-shortcut-chords: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shortcut-chords.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-shortcut-chords: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD chords " "$ENGINE_LOG"
sleep 1

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
CHORDS=$(grep -oE '"GUARD chords [^"]*"' "$ENGINE_LOG" | head -1)
WANTED='"GUARD chords bad=SyntaxError missing=NotFoundError page=taken,taken,free heard=Meta+Shift+l,Meta+Shift+l released=Meta+Shift+l"'

if [ -z "$CHORDS" ]; then
  FAILURE="the page never said how its chords went, so the module did not run or threw"
elif [ "$CHORDS" = "$WANTED" ]; then
  FAILURE=""
else
  FAILURE="the page's chords went $CHORDS where $WANTED was owed: a chord written wrong is a SyntaxError, one the keyboard cannot type a NotFoundError, a grabbed chord pressed on the page is taken from it (a repeat too) and fires once, the compositor's press of it carries the chord, and letting go of one of its modifiers releases it once"
fi

echo "page: $CHORDS"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-shortcut-chords: $FAILURE" "$ENGINE_LOG"
  echo "guard-shortcut-chords: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a chord grabbed by name comes back by name"
