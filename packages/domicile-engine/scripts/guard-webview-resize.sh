#!/usr/bin/env bash
# Guard: a browser window still draws and takes presses after many resizes.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-resize.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. Presses go
# in and the screen is read back over the debugging port; see
# guard_webview_devtools.py.
#
# Why: a browser window resized many times in a row has been seen to stop
# drawing and taking input for good. Reloading its page does not bring it
# back.
#
# The shell opens one browser window under a strip. The page in it fills itself
# with a new color on every press. In order:
#
#   the shell page ran
#   the window was drawn and its page loaded
#   a press in the window landed in the page   the harness reaches the page
#   the screen shows the page's new color      the harness reads its frames
#   a press on the strip resized the window    the resizes ran and ended
#   the page has the element's final size      the page heard the last resize,
#                                              and in the claim others before it
#   a press in the window landed in the page   the claim: it takes input
#   the screen shows the page's new color      the claim: it draws
#
# Control: NEGATIVE=1 runs the same steps with a strip that resizes nothing.
# Every reading must hold there too. A failure in both runs is this harness; a
# failure in the claim alone is the resizes.
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
  annotate "guard-webview-resize: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="burst"
[ "$NEGATIVE" = "1" ] && MODE="still"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-resize$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-resize$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-resize$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-resize$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-resize$WHICH-mouse.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# Not named `STRIP`: `nix develop .#full` exports STRIP=strip.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
# How many boxes the burst gives the element, two per frame.
RESIZE_STEPS="${RESIZE_STEPS:-1200}"
# Time allowed for the shell to load, open the window and finish the burst.
# Generous because the build machine is shared.
FOR_SECONDS="${FOR_SECONDS:-120}"
# Time for frames to settle before a press or a read: hit testing and the
# capture both use submitted frames.
SETTLE_SECONDS="${SETTLE_SECONDS:-3}"

STRIP_X=$((WIDTH / 2))
STRIP_Y=$((STRIP_HEIGHT / 2))
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-resize: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-resize: no python3, and the page, the presses and the capture are all driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# How many lines of the engine's log contain $1.
count() {
  grep -c -F -- "$1" "$ENGINE_LOG" 2>/dev/null || true
}

# Waits up to `$1` quarter-seconds for `$2` to appear `$3` times.
wait_for_count() { # $1 tries, $2 pattern, $3 count
  for _ in $(seq 1 "$1"); do
    [ "$(count "$2")" -ge "$3" ] && return 0
    sleep 0.25
  done
  return 1
}

press() { # $1 x, $2 y
  python3 "$SCRIPTS/guard-webview-click-mouse.py" \
    --port "$DEBUG_PORT" --x "$1" --y "$2" >>"$CLICK_LOG" 2>&1 ||
    echo "a press at $1,$2 could not be driven; see $CLICK_LOG" >&2
}

# The color the page chose on its `$1`th press, or nothing.
painted() { # $1 which press
  sed -n 's/.*GUARD guest-painted color=\(#[0-9a-f]*\).*/\1/p' "$ENGINE_LOG" |
    sed -n "$1p"
}

# Whether the screen shows the page's `$1`th color at the window's center.
shows() { # $1 which press
  local want got
  want="$(painted "$1")"
  [ -n "$want" ] || return 1
  got="$(python3 "$SCRIPTS/guard-webview-resize-pixel.py" \
    --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" 2>>"$CLICK_LOG")"
  echo "after press $1 the page chose $want and the screen shows ${got:-nothing}"
  near "$got" "$want"
}

# Whether two `#rrggbb` colors are within 2 per channel. The page's colors are
# random, and a color conversion on the capture path can round one by a unit.
near() { # $1 $2 colors
  local offset a b
  case "$1$2" in
  \#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) return 1 ;;
  esac
  for offset in 1 3 5; do
    a=$((16#${1:offset:2}))
    b=$((16#${2:offset:2}))
    [ $((a > b ? a - b : b - a)) -le 2 ] || return 1
  done
}

# 1. Serve the window's page locally; `crux` cannot reach external hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-resize-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-resize: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-resize: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The engine, on a domicile:// page, the only origin WebViewGuestHost is
#    bound for.
rm -f "$ENGINE_LOG" "$CLICK_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?mode=$MODE&strip=$STRIP_HEIGHT&steps=$RESIZE_STEPS&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-resize.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran; the verdict below says what that means" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-resize: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. Before: the harness reaches the page and reads its frames.
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep "$SETTLE_SECONDS"
press "$WINDOW_X" "$WINDOW_Y"
wait_for_count 40 "GUARD guest-painted" 1
sleep "$SETTLE_SECONDS"
BEFORE_SHOWN=0
shows 1 && BEFORE_SHOWN=1

# 4. The burst, started from the strip.
press "$STRIP_X" "$STRIP_Y"
wait_for_line "$TRIES" "GUARD resized" "$ENGINE_LOG" ||
  echo "the resizes never ended" >&2
sleep "$SETTLE_SECONDS"

# 5. After: the same press and read.
press "$WINDOW_X" "$WINDOW_Y"
wait_for_count 40 "GUARD guest-painted" 2
sleep "$SETTLE_SECONDS"
AFTER_SHOWN=0
shows 2 && AFTER_SHOWN=1

# The readings, all from the engine's log but the two captures.
seen() { # $1 pattern
  [ "$(count "$1")" -ge 1 ] && echo 1 || echo 0
}
SHELL_RAN=$(seen "GUARD shell-loaded")
DRAWN=$(seen "GUARD drawn id=")
LOADED=$(seen "GUARD guest-loaded")
PRESSES="$(count "GUARD guest-painted")"
BEFORE_PRESSED=0
[ "$PRESSES" -ge 1 ] && BEFORE_PRESSED=1
AFTER_PRESSED=0
[ "$PRESSES" -ge 2 ] && AFTER_PRESSED=1
RESIZED=$(seen "GUARD resized")
RESIZED_TO="$(sed -n 's/.*GUARD resized \(width=[0-9.]* height=[0-9.]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
GUEST_SIZE="$(sed -n 's/.*GUARD guest-size \(width=[0-9.]* height=[0-9.]*\).*/\1/p' "$ENGINE_LOG" | tail -1)"
# The burst ends at the size the page loaded at, so the last size alone would
# hold with no resize ever reaching the page. The claim also needs a size other
# than the last one, reported after the burst started.
MIDWAY="$(awk -v last="GUARD guest-size $GUEST_SIZE\"" '
  /GUARD burst-started/ { started = 1 }
  started && /GUARD guest-size / && index($0, last) == 0 { n++ }
  END { print n + 0 }' "$ENGINE_LOG")"
SIZED=0
[ -n "$RESIZED_TO" ] && [ "$GUEST_SIZE" = "$RESIZED_TO" ] &&
  { [ "$MODE" = "still" ] || [ "$MIDWAY" -ge 1 ]; } && SIZED=1

MEASURED="$MODE $SHELL_RAN $DRAWN $LOADED $BEFORE_PRESSED $BEFORE_SHOWN $RESIZED $SIZED $AFTER_PRESSED $AFTER_SHOWN"
echo
echo "the element ended at: ${RESIZED_TO:-nothing}; the page last saw: ${GUEST_SIZE:-nothing}, after $MIDWAY other size(s) during the burst"
echo "measured: $MEASURED"
echo "  (mode shell drawn loaded pressed-before shown-before resized sized pressed-after shown-after)"

# Which step to blame. `scripts/test-webview-resize-guard.sh` runs this block
# directly. MEASURED is "<mode> <shell> <drawn> <loaded> <pressed-before>
# <shown-before> <resized> <sized> <pressed-after> <shown-after>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"burst 1 1 1 1 1 1 1 1 1")
  PASSED="a browser window given $RESIZE_STEPS boxes still has the \
element's size, takes a press and draws the page's next frame"
  ;;
"still 1 1 1 1 1 1 1 1 1")
  PASSED="the control holds: a browser window that was never resized takes \
both presses and draws both frames, so a failure in the claim is the resizes"
  ;;
"burst 0 "* | "still 0 "*)
  FAILURE="the shell page never ran, so nothing here was ever set up: the \
module did not load, or it threw, and the engine log has its console"
  ;;
"burst 1 0 "* | "still 1 0 "*)
  FAILURE="the shell never drew a browser window: openBrowserWindow opened \
none ('opened browser window' in the log), or browserwindowschanged never \
listed it"
  ;;
"burst 1 1 0 "* | "still 1 1 0 "*)
  FAILURE="the window's page never loaded: the <webview window> was not \
given the page (AttachToElement, AttachWindowTo), or it never navigated"
  ;;
"burst 1 1 1 0 "* | "still 1 1 1 0 "*)
  FAILURE="the first press, before any resize, never reached the page. That \
is this harness or the element's box: the press is aimed at the window's \
center"
  ;;
"burst 1 1 1 1 0 "* | "still 1 1 1 1 0 "*)
  FAILURE="before any resize, the screen did not show the color the page \
chose. That is this harness: Page.captureScreenshot did not read the guest's \
frame"
  ;;
"burst 1 1 1 1 1 0 "* | "still 1 1 1 1 1 0 "*)
  FAILURE="the press on the strip never ended in a resized line: the press \
missed the strip, or the burst threw or never finished its frames"
  ;;
"burst 1 1 1 1 1 1 0 "*)
  FAILURE="THE PAGE DID NOT GET THE LAST SIZE: after the resizes the element \
and the page disagree on the window's size, or the page never heard a size \
but its first, so the guest's widget stopped taking new visual properties \
from its frame"
  ;;
"burst 1 1 1 1 1 1 1 0 "*)
  FAILURE="THE WINDOW TAKES NO INPUT AFTER THE RESIZES: the same press that \
reached the page before them did not after. The hit test no longer finds the \
guest's surface"
  ;;
"burst 1 1 1 1 1 1 1 1 0")
  FAILURE="THE WINDOW STOPPED DRAWING AFTER THE RESIZES: the page took the \
press and chose a color, and the screen still shows an older frame. The shell \
embeds a guest surface the page no longer submits"
  ;;
"still "*)
  FAILURE="the control failed after its strip press, with nothing resized: \
the claim's readings for the same step say nothing about resizing"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the run did not get as far as reading, or ran a mode this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-resize: $FAILURE" "$ENGINE_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal|crashed" "$ENGINE_LOG" | head -150 >&2
echo "what the presses and captures said:" >&2
tail -20 "$CLICK_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
