#!/usr/bin/env bash
# Checks that a color input in a browser window's page asks the shell for its
# picker instead of drawing Chrome's, and that the color the shell picks
# reaches the page (patch 0182). See packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-page-picker.sh /build/chromium/src
#
# Runs headless: nothing here is measured in pixels.
#
# Chrome draws a page's color, date and time pickers as page popups of its
# own. Patch 0182 sends them to the page's <webview> as PickerRequested, and
# the element fires `domicile-picker`. The date and time pickers and a
# <datalist> take the same path; the color one stands for them.
#
# The page (guard-webview-file-chooser-server.py's /color) is a full-page color
# input set to black that suggests #1971c2. A press opens its picker.
#
# Checks, in order:
#
#   the shell page ran
#   a press reached the shell's        the harness can deliver a click
#     document
#   the page in the window ran         a guest was made, attached and navigated
#   the press reached the page
#   the browser asked the shell        the page's picker went to WebViewGuest,
#                                      not Chrome's popup
#   the shell heard it                 `domicile-picker` reached it, as color,
#                                      with the value, the suggestion and the
#                                      input's box
#   the shell answered                 its answer did not throw
#   the browser got the answer         WebViewGuest logged it
#   the page holds the shell's color   the main claim
#
# NEGATIVE=1 is the control: the shell cancels. The page must keep black.
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
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-page-picker: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-page-picker-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-page-picker-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# Not `STRIP`, which the build shell exports as a program. See
# guard-webview-new-window.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The center of the guest, which the color input fills.
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

FOR_SECONDS="${FOR_SECONDS:-90}"

# What the shell picks (not the page's suggestion, so the page cannot have
# picked it alone), and what the input holds before.
PICK="#ff8800"
BEFORE="#000000"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-page-picker$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-page-picker$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-page-picker$WHICH-mouse.log}"

PICKER="choose"
[ "$NEGATIVE" = "1" ] && PICKER="cancel"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-page-picker: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-page-picker: no python3, and the page in the window and the click are both driven by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page in the window.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-file-chooser-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-page-picker: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-page-picker: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"

# 2. The engine, on a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/color&answer=cancel&picker=$PICKER&value=%23${PICK#\#}" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-file-chooser.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-page-picker: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-page-picker: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. A page in the window, and a settle for its first frame.
wait_for_line "$TRIES" "GUARD color-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep 3

# 4. A press on the shell's strip, to show clicks arrive.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2
wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. The press under test: on the color input, which opens its picker.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# A fixed wait, because the control's readings are absences. Long enough for
# the picker, the answer and the change.
sleep 8

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD color-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
# Logged by WebViewGuest::Pick. Separates "the page never asked the shell"
# from "it asked and the element did not fire".
SAW_ASKED=$(saw "picker; asking the shell.")
SAW_HEARD=$(saw "GUARD picker kind=color value=$BEFORE options=#1971c2 anchor=$WIDTH"x"$((HEIGHT - STRIP_HEIGHT))")
SAW_ANSWERED=$(saw "GUARD picker-answered")
SAW_PICKED=$(saw "domicile: a <webview>'s picker was answered: picked.")
SAW_KEPT=$(saw "domicile: a <webview>'s picker was answered: kept.")
SAW_CHANGED=$(saw "GUARD color value=$PICK")
SAW_ANY_CHANGE=$(saw "GUARD color value=")
SAW_SETTLED=$SAW_PICKED
[ "$NEGATIVE" = "1" ] && SAW_SETTLED=$SAW_KEPT

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_CHROME guest=$SAW_GUEST"
echo "picker: asked=$SAW_ASKED heard=$SAW_HEARD answered=$SAW_ANSWERED settled=$SAW_SETTLED"
echo "the page: changed=$SAW_CHANGED any change=$SAW_ANY_CHANGE"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-page-picker-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so every reading \
below is about a desktop nobody touched. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no input to press. \
That is the guest: not made, not attached, or not navigated"
elif [ "$SAW_GUEST" != "1" ]; then
  FAILURE="the press never reached the page in the window. That is this \
harness or the element's box rather than anything about pickers"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE PAGE NEVER ASKED THE SHELL: the color input was pressed and no \
picker reached WebViewGuest. ChromeClientImpl::OpenColorChooser drew Chrome's \
popup (DomicilePagePicker::IsShellsFor said no), or PagePicker was not bound \
for the guest's frame"
elif [ "$SAW_HEARD" != "1" ]; then
  FAILURE="the browser asked and the shell never heard it as a color picker \
with black, the suggestion and the input's box. PickerRequested did not reach \
the element, or the anchor was not moved into the element's pixels"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell heard the picker and its answer threw. The engine log \
has the shell's console"
elif [ "$SAW_SETTLED" != "1" ]; then
  FAILURE="the shell answered and the browser never logged that answer. The \
reply did not reach WebViewGuest::Pick"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY_CHANGE" = "1" ]; then
    FAILURE="THE CONTROL CHANGED THE COLOR: the shell canceled and the page \
changed anyway, so the positive run's color is not the shell's answer"
  else
    PASSED="the control is sharp: the shell canceled and the page kept its \
color. So what the positive run reads is the shell's answer"
  fi
elif [ "$SAW_CHANGED" = "1" ]; then
  PASSED="a color input in a browser window asked the shell for its picker in \
place of Chrome's, and the page took the color the shell picked"
else
  FAILURE="the shell picked $PICK and the page never had it. \
DomicileColorChooser did not parse the answer, or did not tell the input"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-page-picker: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
