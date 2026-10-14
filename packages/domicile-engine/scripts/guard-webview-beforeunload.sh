#!/usr/bin/env bash
# A browser window whose page has a `beforeunload` handler asks the shell
# before it closes: the shell's Cancel keeps the page, and its Leave closes the
# window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-beforeunload.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-dialog.sh: nothing
# here is measured in pixels.
#
# `closeBrowserWindow` runs the page's `beforeunload` (WebViewGuest::
# AskToClose). A handler that asks to stay reaches WebViewGuest::
# RunBeforeUnloadDialog, which sends it to the element as DialogRequested, and
# the element fires `domicile-dialog` with `dialogType` `beforeunload`. The
# answer reaches content, which reports it in BeforeUnloadFired. A unit test
# cannot check this: happy-dom has no guest and no renderer to pause.
#
# The page is guard-webview-beforeunload-server.py's: a plain top half and an
# arm button in the bottom half. The press gives the page the user activation
# Chrome requires before a `beforeunload` may ask. The page then moves to
# `#pressed`, which tells the shell to close the window.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   a press reached the shell's      the harness can deliver a press; without
#     document                        it, an absence below means nothing
#   there is a page in the window    a guest was made, attached and navigated
#   a press reached the page         the hit test crossed into the guest
#   the shell asked to close         the page reached `#pressed`
#   the page armed its handler       the press was on the button
#   the browser asked the page       AskToClose ran DispatchBeforeUnload
#   the browser asked the shell      WebViewGuest::RunBeforeUnloadDialog ran
#   the shell heard the dialog       `domicile-dialog` reached it as a
#                                     `beforeunload`
#   Cancel kept the window           still listed after the shell's dismiss()
#   Leave closed it                  gone after the second close's accept()
#
# NEGATIVE=1 is the control: the press lands on the plain half, which arms
# nothing. The window must close with no dialog, or the positive run's dialog
# could come from the close itself rather than the page's handler.
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
  annotate "guard-webview-beforeunload: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-beforeunload-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-beforeunload-profile}"
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
# each report the run waits on.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-beforeunload$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-beforeunload$WHICH-http.log}"
INPUT_LOG="${INPUT_LOG:-/tmp/domicile-webview-beforeunload$WHICH-input.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-beforeunload: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-beforeunload: no python3, and the page in the window and the pointer are both driven by one"
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
python3 "$SCRIPTS/guard-webview-beforeunload-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-beforeunload: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-beforeunload: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page with an arm button at $SITE/page"

# 2. The engine, on a domicile:// document, because the browser binds
#    BrowserWindows and WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-beforeunload.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-beforeunload: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-beforeunload: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a browser window under a ${STRIP_HEIGHT}px strip"

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

# 5. The button, or the plain half in the control. Either way the shell then
#    closes the window, and the run waits for it to go.
if [ "$NEGATIVE" = "1" ]; then
  click "$WINDOW_X" "$PLAIN_Y" ||
    echo "the press on the page could not be driven; see $INPUT_LOG" >&2
else
  click "$WINDOW_X" "$BUTTON_Y" ||
    echo "the press on the button could not be driven; see $INPUT_LOG" >&2
fi
wait_for_line "$TRIES" "GUARD window-closed" "$ENGINE_LOG" ||
  echo "the window never closed" >&2

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_PRESS=$(saw "GUARD page-mousedown")
SAW_ARMED=$(saw "GUARD page-armed")
SAW_CLOSING=$(saw "GUARD closing")
SAW_ASKED_PAGE=$(saw "domicile: asked a <webview>'s page whether it may close.")
SAW_ASKED_SHELL=$(saw "domicile: a <webview>'s page asked to stay; asking the shell.")
SAW_HEARD=$(saw "GUARD dialog type=beforeunload message=")
SAW_STAYED=$(saw "GUARD still-open")
SAW_CLOSED=$(saw "GUARD window-closed")
SAW_ANY=$( (grep -qF "GUARD dialog" "$ENGINE_LOG" ||
  grep -qF "page asked to stay" "$ENGINE_LOG") && echo 1 || echo 0)

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "presses: chrome=$SAW_CHROME page=$SAW_PRESS armed=$SAW_ARMED"
echo "close: closing=$SAW_CLOSING asked-page=$SAW_ASKED_PAGE asked-shell=$SAW_ASKED_SHELL heard=$SAW_HEARD stayed=$SAW_STAYED closed=$SAW_CLOSED any=$SAW_ANY"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `scripts/test-webview-beforeunload-guard.sh` runs this block directly.
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
elif [ "$SAW_CLOSING" != "1" ]; then
  FAILURE="the page was pressed and the shell never asked to close the window. \
The page did not reach #pressed, or domicile-page-change did not say so"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY" = "1" ]; then
    FAILURE="the control's page has no beforeunload handler and a dialog was \
reported anyway, so the positive run's dialog may come from the close rather \
than the page"
  elif [ "$SAW_CLOSED" != "1" ]; then
    FAILURE="the control's page has no beforeunload handler and its window \
never closed. closeBrowserWindow no longer closes a page with nothing to ask"
  else
    PASSED="the control is sharp: a page with no handler closed with no dialog"
  fi
elif [ "$SAW_ARMED" != "1" ]; then
  FAILURE="the press reached the page and it never armed its handler, so \
there was nothing to ask. The press missed the button"
elif [ "$SAW_ASKED_PAGE" != "1" ]; then
  FAILURE="the shell asked to close an armed page and the browser never asked \
it. AskToClose did not run DispatchBeforeUnload, so the window was closed \
without its beforeunload"
elif [ "$SAW_ASKED_SHELL" != "1" ]; then
  FAILURE="the page was asked and the browser never asked the shell. The \
renderer refused the dialog, or RunBeforeUnloadDialog left without asking"
elif [ "$SAW_HEARD" != "1" ]; then
  FAILURE="the browser asked and the shell never heard. DialogRequested did \
not reach the element, or the element did not fire domicile-dialog as a \
beforeunload"
elif [ "$SAW_STAYED" != "1" ]; then
  FAILURE="the shell answered Cancel and the window closed anyway. The answer \
did not reach content, or BeforeUnloadFired closed on a refusal"
elif [ "$SAW_CLOSED" != "1" ]; then
  FAILURE="the shell answered Leave and the window never closed. \
BeforeUnloadFired did not close it"
else
  PASSED="the page asked the shell before closing: Cancel kept it, and Leave \
closed it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-beforeunload: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the input did:" >&2
tail -20 "$INPUT_LOG" >&2
exit 1
