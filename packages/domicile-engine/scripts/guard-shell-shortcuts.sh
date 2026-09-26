#!/usr/bin/env bash
# Chrome's own shortcuts, pressed at a shell that handles none of them.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-shortcuts.sh /build/chromium/src
#
# Headless and software-composited, like the webview guards: nothing here is
# measured in pixels.
#
# WHY THIS EXISTS. A shell runs in a Chrome app window, and a key the shell did
# not preventDefault fell through to that window's accelerators: Ctrl+R and F5
# reloaded the desktop, Alt+Left took it back, F11 took a CRTC-sized window out
# of fullscreen, Ctrl+= zoomed it, Ctrl+W closed it and Ctrl+Shift+Q quit it.
# Patch 0047 leaves every such key unhandled.
#
# WHAT IT ASSERTS, in order:
#
#   the shell loaded                  or nothing was pressed at a shell
#   the browser still answers         Ctrl+W and Ctrl+Shift+Q did nothing
#   every chord reached the shell     so each one came back unhandled to the
#                                     delegate the accelerators ran from
#   the shell loaded once             Ctrl+R and F5 did nothing
#   no popstate and no resize         Alt+Left, F11 and Ctrl+= did nothing
#
# THE CLAIM IS AN ABSENCE, so NEGATIVE=1 keeps the setup and has the browser
# reload the shell over the debugging port where the chords would have gone. A
# guard that cannot see that reload cannot see one a key caused either.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-shortcuts: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# Each chord as `code key evdev vkey modifiers...`: a DOM code and key for the
# event, evdev for the native keycode (without one content marks the event
# skip_if_unhandled and it never reaches a delegate), and the VKEY Chrome's
# accelerator table is keyed on.
CHORDS=(
  "Equal = 13 187 --ctrl"
  "F11 F11 87 122"
  "ArrowLeft ArrowLeft 105 37 --alt"
  "KeyR r 19 82 --ctrl"
  "F5 F5 63 116"
  "KeyW w 17 87 --ctrl"
  "KeyQ Q 16 81 --ctrl --shift"
)
# And a plain key afterward: a browser that answers it is still running.
AFTER="KeyA a 30 65"

DEBUG_PORT="${DEBUG_PORT:-9238}"
OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shell-shortcuts-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-shortcuts-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# A reload, a history step and a resize are each a task or two away from the
# key; this is a flush, not a race.
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

# `--app` because it is what `domicile` runs, and it is the window whose
# accelerators this is about.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-shortcuts.js" \
  --remote-debugging-port="$DEBUG_PORT" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

wait_for_line $((FOR_SECONDS * 4)) "GUARD loaded" "$ENGINE_LOG" ||
  echo "the shell never loaded" >&2

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
    # Not a reading: a chord that closed the browser errors here too, and the
    # key after them is what tells that apart.
    press "$chord" || echo "pressing $chord came back an error; see $KEY_LOG" >&2
  done
fi

sleep "$SETTLE_SECONDS"
HEARD=$(grep -c "GUARD keydown" "$ENGINE_LOG")

PRESSED_AFTER=0
press "$AFTER" && PRESSED_AFTER=1

LOADS=$(grep -c "GUARD loaded" "$ENGINE_LOG")
MOVED=$(grep -cE "GUARD (popstate|resized)" "$ENGINE_LOG")
SAW_LOADED=$([ "$LOADS" -ge 1 ] && echo 1 || echo 0)
HEARD_ALL=$([ "$HEARD" -ge "${#CHORDS[@]}" ] && echo 1 || echo 0)

echo
echo "loaded=$SAW_LOADED heard=$HEARD/${#CHORDS[@]} after=$PRESSED_AFTER loads=$LOADS moved=$MOVED"
echo

# The verdict, run directly by `scripts/test-shell-shortcuts-guard.sh`.
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
tail -40 "$ENGINE_LOG" >&2
echo "what the keystrokes did:" >&2
tail -20 "$KEY_LOG" >&2
exit 1
