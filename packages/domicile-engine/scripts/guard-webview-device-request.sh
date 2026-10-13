#!/usr/bin/env bash
# A page in a browser window asks for a device through WebHID, the shell is
# asked, and its answer reaches the page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-device-request.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-click.sh: nothing here
# is measured in pixels.
#
# A page's `navigator.hid.requestDevice()` reaches Chrome's
# ShowDeviceChooserDialog, a bubble on a browser window that a guest has none
# of, so the page was given no device. Patch 0110's override hands the chooser
# to //chrome/browser/domicile/domicile_device_chooser.h, which asks the
# element through DeviceRequested; the element fires
# `domicile-device-request`. The shell cancels, which the page sees as no
# devices. A unit test cannot check this: happy-dom has no guest and no
# device service.
#
# The page is guard-webview-device-request-server.py's: a plain top half and a
# connect button in the bottom half. WebHID needs a user gesture, hence the
# press.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   a press reached the shell's      the harness can deliver a press; without
#     document                        it, an absence below means nothing
#   there is a page in the window    a guest was made, attached and navigated
#   a press reached the page         the hit test crossed into the guest
#   the request was not refused      Blink let the page ask
#   the browser asked the shell      WebViewGuest::AskForDevice ran
#   the shell heard the request      `domicile-device-request` reached it
#   the shell answered               its cancel did not throw
#   the browser took the answer      ShellDeviceChooser acted on it
#   the page got the answer          requestDevice() settled with no devices
#
# NEGATIVE=1 is the control: the press lands on the plain half, which asks for
# nothing. Nothing may be reported, or the positive run's report could come
# from the press or the load rather than the request.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-device-request: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-device-request-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-device-request-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Height of the shell's strip in CSS pixels. The press points derive from it.
#
# Not `STRIP`: `nix develop .#full` exports `STRIP=strip`, which breaks the
# arithmetic below under `set -u`. `scripts/test-webview-guard-startup.sh`
# starts every guard in that environment to catch this.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middles of the guest's two halves: the plain one and the button.
WINDOW_X=$((WIDTH / 2))
PLAIN_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 4))
BUTTON_Y=$((STRIP_HEIGHT + 3 * (HEIGHT - STRIP_HEIGHT) / 4))

# Time for the shell to load and its guest to attach and navigate, and for
# each report the positive run waits on.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-device-request$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-device-request$WHICH-http.log}"
INPUT_LOG="${INPUT_LOG:-/tmp/domicile-webview-device-request$WHICH-input.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-device-request: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-device-request: no python3, and the page in the window and the pointer are both driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page: one local server, because `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-device-request-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-device-request: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-device-request: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page with a connect button at $SITE/page"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-device-request.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-device-request: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-device-request: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. Wait for the guest's page before pressing on it.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# Hit testing uses submitted compositor frames. The page running does not mean
# its first frame reached the browser, so wait before pressing.
sleep 3

click() { # $1 x, $2 y
  python3 "$SCRIPTS/guard-webview-click-mouse.py" \
    --port "$DEBUG_PORT" --x "$1" --y "$2" >>"$INPUT_LOG" 2>&1
}

# 4. A press on the shell's strip. It proves presses are delivered, so missing
#    readings below are real results.
: >"$INPUT_LOG"
click "$CHROME_X" "$CHROME_Y" ||
  echo "the first press could not be driven; see $INPUT_LOG" >&2
wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first press" >&2

ASKED_LINE="domicile: a <webview>'s page asked for a device; asking the shell."
DECIDED_LINE="domicile: a <webview>'s device request was answered with 0 device(s)."

# 5. The button, or the plain half in the control.
if [ "$NEGATIVE" = "1" ]; then
  click "$WINDOW_X" "$PLAIN_Y" ||
    echo "the press on the page could not be driven; see $INPUT_LOG" >&2
  wait_for_line 20 "GUARD page-mousedown" "$ENGINE_LOG" ||
    echo "the page never reported the press" >&2
  # A fixed wait, not a poll, because the control expects an absence.
  sleep 5
else
  click "$WINDOW_X" "$BUTTON_Y" ||
    echo "the press on the button could not be driven; see $INPUT_LOG" >&2
  wait_for_line "$TRIES" "GUARD page-devices" "$ENGINE_LOG" ||
    echo "the page's request never settled" >&2
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_PRESS=$(saw "GUARD page-mousedown")
SAW_REFUSED=$(saw "GUARD page-devices refused")
SAW_ASKED=$(saw "$ASKED_LINE")
SAW_REQUEST=$(saw "GUARD device-request title=")
SAW_ANSWERED=$(saw "GUARD device-request-answered")
SAW_DECIDED=$(saw "$DECIDED_LINE")
SAW_SETTLED=$(saw "GUARD page-devices count=0")
SAW_ANY=$( (grep -qF "GUARD device-request" "$ENGINE_LOG" ||
  grep -qF "GUARD page-devices" "$ENGINE_LOG" ||
  grep -qF "$ASKED_LINE" "$ENGINE_LOG") && echo 1 || echo 0)

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "presses: chrome=$SAW_CHROME page=$SAW_PRESS"
echo "request: refused=$SAW_REFUSED asked=$SAW_ASKED heard=$SAW_REQUEST answered=$SAW_ANSWERED decided=$SAW_DECIDED settled=$SAW_SETTLED any=$SAW_ANY"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `scripts/test-webview-device-request-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up. This is the \
harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document, so the pointer was never \
delivered to this browser. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing loaded in the window, so there was no button to press. That \
is the guest: it was not made, attached or navigated"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="no press reached the page, so the hit test stopped at the shell. \
Nothing below was measured"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY" = "1" ]; then
    FAILURE="the control pressed the half of the page that asks for nothing \
and a device request was reported anyway, so the positive run's report may \
come from the press or the load rather than the request"
  else
    PASSED="the control is sharp: a press that asked for nothing reported no \
device request"
  fi
elif [ "$SAW_REFUSED" = "1" ]; then
  FAILURE="the page's requestDevice() was refused before any chooser. Blink \
refused it: no user activation from the press, or WebHID is off for the page"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="the page asked for a device and the browser never asked the shell. \
ShowDeviceChooserDialog did not take patch 0110's override, or the override \
did not find the page's WebViewGuest"
elif [ "$SAW_REQUEST" != "1" ]; then
  FAILURE="the browser asked and the shell never heard. DeviceRequested did \
not reach the element, or the element did not fire domicile-device-request"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell heard the request and its cancel() did not return. The \
event's answer threw: the engine log has the shell's console"
elif [ "$SAW_DECIDED" != "1" ]; then
  FAILURE="the shell answered and the browser never acted on it. The reply \
did not reach ShellDeviceChooser, or it was dropped as stale"
elif [ "$SAW_SETTLED" != "1" ]; then
  FAILURE="the browser took the answer and the page's requestDevice() never \
settled with no devices, so the page is left waiting. The controller's \
Cancel and destruction must answer it"
else
  PASSED="the page asked for a device, the shell was asked, and its answer \
reached the page"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-device-request: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the input did:" >&2
tail -20 "$INPUT_LOG" >&2
exit 1
