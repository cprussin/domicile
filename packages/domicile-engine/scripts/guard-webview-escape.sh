#!/usr/bin/env bash
# Guard: pressing Escape in the shell with a browser window open does not crash
# the browser.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-escape.sh /build/chromium/src
#
# Runs headless with software compositing; nothing here is measured in pixels.
#
# Attaching a guest creates a `BrowserPluginEmbedder` on the shell's
# WebContents. An unhandled Escape makes it read the browser context's
# `BrowserPluginGuestManager`, which is null in this fork (no //extensions or
# //components/guest_view), and `BrowserPluginEmbedder::HandleKeyboardEvent`
# does not check. Patch 0037 fixes it; see
# `upstream/browser-plugin-embedder-null-guest-manager.md`.
#
# Only a real engine has a guest, an embedder and no guest manager, so a unit
# test cannot cover this.
#
# Assertions, in order:
#
#   the guest page loaded (so the shell's WebContents is an embedder)
#   a key before Escape is delivered (the harness works)
#   no crash signal in the log (the claim)
#   a key after Escape is delivered (the browser is still alive)
#
# The keyboard stays in the shell: a focused guest handles keys in its own
# WebContents, which has no embedder.
#
# NEGATIVE=1 kills the browser with SIGSEGV instead of pressing Escape. Both
# readings must change: the signal appears and the later key fails. This proves
# the guard can see a dead browser.
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
  annotate "guard-webview-escape: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"

# Escape in every form the path needs: DOM code and key, evdev code (the driver
# derives the XKB keycode from it) and VKEY (content compares
# `windows_key_code`).
ESCAPE_EVDEV=1
ESCAPE_CODE="Escape"
ESCAPE_KEY="Escape"
ESCAPE_VKEY=27

# Keys pressed before and after Escape: the first checks the harness, the
# second checks the browser is alive.
BEFORE_EVDEV=48
BEFORE_CODE="KeyB"
BEFORE_KEY="b"
BEFORE_VKEY=66
AFTER_EVDEV=30
AFTER_CODE="KeyA"
AFTER_KEY="a"
AFTER_VKEY=65

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-escape-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-escape-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Time allowed for the shell to load and attach and navigate a guest. Generous
# because the build machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# Time for a crash stack to reach the log. A fixed wait, because the positive
# run checks for an absence. Five seconds is enough: the fault is synchronous
# with the keystroke, and the later key is the real liveness check. Both runs
# pay it once, so no `lib-control-budget.sh`.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# Separate logs for the control run, so it does not overwrite the positive
# run's logs.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-escape$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-escape$WHICH-http.log}"
KEY_LOG="${KEY_LOG:-/tmp/domicile-webview-escape$WHICH-key.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-escape: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-escape: no python3, and the page in the window and the keystrokes are all driven by one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# Waits up to `$1` quarter seconds for `$2` to appear in `$3`.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. Serve the window's page locally; `crux` cannot reach external hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-escape: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-escape: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"
echo "serving a browser window's page at $SUBJECT"

# 2. Start the engine on a domicile:// page, the only origin WebViewGuestHost
#    is bound for. `--app` matches how `domicile` runs it.
#
#    Keys go in over `--remote-debugging-port`, since there is no keyboard; see
#    guard-webview-keyboard-key.py.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-escape.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!
STARTED+=("$ENGINE")

# 3. Wait for the guest page; without a guest the shell is not an embedder.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-escape: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 4. Press a key first to check that keys reach the browser at all.
press() { # $1 code, $2 key, $3 evdev, $4 vkey
  python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
    --port "$DEBUG_PORT" --code "$1" --key "$2" \
    --evdev "$3" --windows-key-code "$4" >>"$KEY_LOG" 2>&1
}

: >"$KEY_LOG"
PRESSED_BEFORE=0
press "$BEFORE_CODE" "$BEFORE_KEY" "$BEFORE_EVDEV" "$BEFORE_VKEY" &&
  PRESSED_BEFORE=1
[ "$PRESSED_BEFORE" = "1" ] ||
  echo "the first key could not be driven; see $KEY_LOG" >&2

# 5. Press Escape, or in the control, send SIGSEGV.
if [ "$NEGATIVE" = "1" ]; then
  echo "killing the browser process with SIGSEGV instead of pressing Escape"
  kill -SEGV "$ENGINE" 2>/dev/null
else
  echo "pressing $ESCAPE_CODE at the shell, with a browser window on the page"
  # Status ignored: a crash and an undeliverable key both fail here. The
  # readings below tell them apart.
  press "$ESCAPE_CODE" "$ESCAPE_KEY" "$ESCAPE_EVDEV" "$ESCAPE_VKEY" ||
    echo "the Escape press came back an error; see $KEY_LOG" >&2
fi

sleep "$SETTLE_SECONDS"

# 6. Press a key after, to check the browser is still running.
PRESSED_AFTER=0
press "$AFTER_CODE" "$AFTER_KEY" "$AFTER_EVDEV" "$AFTER_VKEY" &&
  PRESSED_AFTER=1

SAW_GUEST=$(grep -qF "GUARD guest-loaded" "$ENGINE_LOG" && echo 1 || echo 0)
# Printed by Chromium's signal handler with a stack naming the process.
SAW_CRASH=$(grep -qF "Received signal" "$ENGINE_LOG" && echo 1 || echo 0)

echo
echo "guest=$SAW_GUEST before=$PRESSED_BEFORE crash=$SAW_CRASH after=$PRESSED_AFTER"
echo

# Turn the readings into a verdict. `scripts/test-webview-escape-guard.sh`
# tests this block. Setup readings are checked first, for both runs.
FAILURE=""
PASSED=""
if [ "$SAW_GUEST" != "1" ]; then
  FAILURE="nothing ever loaded in the browser window, so there was no guest \
and the shell's WebContents was never made an embedder — which is the object \
the press under test is offered to. Nothing here was measured. That is the \
guest: it was not made, not attached, or not navigated; the engine's log has \
the browser's own line for an attach, and the http log says whether the page \
was ever asked for"
elif [ "$PRESSED_BEFORE" != "1" ]; then
  FAILURE="a key could not be driven at this browser at all, so the keystroke \
under test never left the harness and nothing below is a measurement. This is \
the harness: the debugging port, or the shell's page not being the target the \
driver picks"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_CRASH" != "1" ]; then
    FAILURE="the control killed the browser process with SIGSEGV and no signal \
reached the engine's log. So this guard cannot see a crash, the positive run's \
silence is the same silence, and the run establishes nothing. Chromium's stack \
dumping is what is missing — an official build installs no handler"
  elif [ "$PRESSED_AFTER" = "1" ]; then
    FAILURE="the control killed the browser process and a keystroke afterward \
was still answered. The debugging port is then answering for something other \
than the browser under test — a second engine, or a port that outlived it — \
and the positive run's liveness reading rests on it"
  else
    PASSED="the control is sharp: a browser process that dies takes both \
readings with it — the signal reaches the log and the keystroke after it is \
refused — so the positive run's silence is a measurement rather than a blind \
spot"
  fi
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. A plain Escape at a shell with a browser \
window on it is what this guard presses, and the last time that crashed it was \
browser_plugin_embedder.cc walking a null BrowserPluginGuestManager — the fork \
has no guest manager, and HandleKeyboardEvent is the one method there that does \
not check. Patch 0037 is the fix; read the dumped stack before assuming it is \
the same one"
elif [ "$PRESSED_AFTER" != "1" ]; then
  FAILURE="no signal was dumped and the browser stopped answering the \
debugging port anyway, so it went away without saying why. Not the crash this \
guard is about — read the end of the engine's log for what it was doing"
else
  PASSED="a plain Escape pressed at the shell, with a guest attached and the \
keyboard still in the shell's own document, left the browser process running \
and dumped no signal"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-escape: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the keystrokes did:" >&2
tail -20 "$KEY_LOG" >&2
exit 1
