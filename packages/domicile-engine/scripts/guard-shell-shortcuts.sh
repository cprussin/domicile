#!/usr/bin/env bash
# Checks that Chrome's shortcuts do nothing when pressed at a shell that does
# not handle them.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-shortcuts.sh /build/chromium/src
#
# Headless and software-composited; nothing is measured in pixels.
#
# Without patch 0047, an unhandled key reaches the app window's accelerators:
# Ctrl+R and F5 reload the desktop, Alt+Left goes back, F11 leaves fullscreen,
# Ctrl+= zooms, Ctrl+W closes and Ctrl+Shift+Q quits.
#
# Asserts, in order:
#
#   the shell loaded
#   the browser still answers         Ctrl+W and Ctrl+Shift+Q did nothing
#   every chord reached the shell     each returned unhandled to the delegate
#   the shell loaded once             Ctrl+R and F5 did nothing
#   no popstate and no resize         Alt+Left, F11 and Ctrl+= did nothing
#
# NEGATIVE=1 reloads the shell over the debugging port instead of pressing
# keys, to prove the guard can see a reload.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-shortcuts: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# Each chord is `code key evdev vkey modifiers...`. The evdev code is required:
# without a native keycode, content marks the event skip_if_unhandled and it
# never reaches the delegate. Chrome's accelerator table is keyed on the VKEY.
CHORDS=(
  "Equal = 13 187 --ctrl"
  "F11 F11 87 122"
  "ArrowLeft ArrowLeft 105 37 --alt"
  "KeyR r 19 82 --ctrl"
  "F5 F5 63 116"
  "KeyW w 17 87 --ctrl"
  "KeyQ Q 16 81 --ctrl --shift"
)
# A plain key afterward, to check the browser is still running.
AFTER="KeyA a 30 65"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shell-shortcuts-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-shortcuts-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# Time for any reload, history step or resize to show up.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shell-shortcuts$WHICH-engine.log}"
KEY_LOG="${KEY_LOG:-/tmp/domicile-shell-shortcuts$WHICH-key.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell-shortcuts: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-shortcuts: no python3, and the keystrokes are driven by one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# `--app`, as `domicile` runs it, since its accelerators are under test.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-shortcuts.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

wait_for_line $((FOR_SECONDS * 4)) "GUARD loaded" "$ENGINE_LOG" ||
  echo "the shell never loaded" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" $((FOR_SECONDS * 4)))" || {
  annotate_from "guard-shell-shortcuts: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

press() { # a CHORDS entry, word-split
  # shellcheck disable=SC2086
  set -- $1
  local code="$1" key="$2" evdev="$3" vkey="$4"
  shift 4
  python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
    --port "$DEBUG_PORT" --code "$code" --key "$key" \
    --evdev "$evdev" --windows-key-code "$vkey" "$@" >>"$KEY_LOG" 2>&1
}

: >"$KEY_LOG"
if [ "$NEGATIVE" = "1" ]; then
  echo "reloading the shell over the debugging port instead of pressing"
  python3 "$SCRIPTS/guard-shell-shortcuts-reload.py" --port "$DEBUG_PORT" \
    >>"$KEY_LOG" 2>&1 || echo "the reload came back an error; see $KEY_LOG" >&2
else
  for chord in "${CHORDS[@]}"; do
    echo "pressing $chord"
    # Not a verdict: a chord that closed the browser also errors. The key
    # pressed afterward tells the two apart.
    press "$chord" || echo "pressing $chord came back an error; see $KEY_LOG" >&2
  done
fi

sleep "$SETTLE_SECONDS"
HEARD=$(grep -c "GUARD keydown" "$ENGINE_LOG")

PRESSED_AFTER=0
press "$AFTER" && PRESSED_AFTER=1

LOADS=$(grep -c "GUARD loaded" "$ENGINE_LOG")
# Count only after the first key: a headless window resizes once on load.
MOVED=$(awk '/GUARD keydown/ { keyed = 1 } keyed && /GUARD (popstate|resized)/ { n++ } END { print n + 0 }' "$ENGINE_LOG")
SAW_LOADED=$([ "$LOADS" -ge 1 ] && echo 1 || echo 0)
HEARD_ALL=$([ "$HEARD" -ge "${#CHORDS[@]}" ] && echo 1 || echo 0)

echo
echo "loaded=$SAW_LOADED heard=$HEARD/${#CHORDS[@]} after=$PRESSED_AFTER loads=$LOADS moved=$MOVED"
echo

# scripts/test-shell-shortcuts-guard.sh runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_LOADED" != "1" ]; then
  FAILURE="the shell never loaded, so nothing was pressed at one. That is the \
engine or the harness, not a shortcut"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$LOADS" -lt 2 ]; then
    FAILURE="the control reloaded the shell and this guard did not read a \
second load, so the positive run's single load is not a measurement"
  elif [ "$PRESSED_AFTER" != "1" ]; then
    FAILURE="the control reloaded the shell and the browser stopped answering \
the debugging port, so the harness cannot tell a live browser from a dead one"
  else
    PASSED="the control is sharp: a reload the browser made is read as one"
  fi
elif [ "$PRESSED_AFTER" != "1" ]; then
  FAILURE="the browser stopped answering after the chords: Ctrl+W closed the \
shell's window or Ctrl+Shift+Q quit the browser, unless the debugging port \
never answered at all (the key log says). Patch 0047's HandleKeyboardEvent in \
BrowserWebContentsDelegate is what leaves them unhandled"
elif [ "$HEARD_ALL" != "1" ]; then
  FAILURE="only $HEARD of ${#CHORDS[@]} chords reached the shell's document, \
so the rest never came back to the delegate the accelerators ran from. That is \
the harness: the debugging port, or keys not reaching the page"
elif [ "$LOADS" != "1" ]; then
  FAILURE="the shell loaded $LOADS times: Ctrl+R or F5 reloaded it. Patch \
0047's HandleKeyboardEvent in BrowserWebContentsDelegate is what leaves them \
unhandled"
elif [ "$MOVED" != "0" ]; then
  FAILURE="the shell's history moved or its viewport changed: Alt+Left, F11 \
or Ctrl+= reached Chrome's accelerators. Patch 0047's HandleKeyboardEvent in \
BrowserWebContentsDelegate is what leaves them unhandled"
else
  PASSED="Chrome's reload, back, fullscreen, zoom, close and quit chords, \
pressed at a shell that handles none of them, did nothing"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-shell-shortcuts: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the keystrokes did:" >&2
tail -20 "$KEY_LOG" >&2
exit 1
