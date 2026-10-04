#!/usr/bin/env bash
# Guard: a click in a browser window's page tells the shell, so it can raise
# the window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-click.sh /build/chromium/src
#
# Runs headless with software compositing; nothing here is measured in pixels.
#
# Blink does not send DOM focus events from a cross-process frame to its owner
# element, so upstream a click in a guest does not reach the shell. Patch 0011
# focuses the <webview> element and dispatches `domicile-guest-focus` on it,
# because Blink suppresses ordinary focus events while the embedder's page is
# unfocused. `BrowserWindow.tsx` raises the window on that event. Its unit test
# cannot check this: happy-dom has no nested browsing context.
#
# Assertions, each meaningful only if the previous one holds:
#
#   the shell page ran
#   a press on the strip reached the shell's document (the harness works)
#   the guest page loaded
#   the press in the window landed in the guest
#   the shell's document got the element's event (the claim)
#   the element is document.activeElement
#
# Extra readings, which do not decide a pass, say where a failure is: the shell
# window's `blur` (only fires if `FocusController::SetFocusedFrame` ran here),
# the guest window's `focus`, and engine log lines around the fork's focus
# branch and `HTMLWebViewElement::DispatchGuestFocus`.
#
# NEGATIVE=1 clicks the shell's strip instead of the window. Nothing may then
# reach the element; otherwise the positive run could be measuring the attach,
# the load, or the shell focusing its own element.
#
# The control is not an <iframe>: on a domicile:// page it stays same-process,
# and a same-process frame's focus does reach its owner.
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
  annotate "guard-webview-click: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-click-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-click-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Height of the shell's strip in CSS pixels. Both click points derive from it
# so they stay in the strip and in the window below it.
#
# Not named `STRIP`: `nix develop .#full` exports STRIP=strip, which breaks the
# arithmetic below under `set -u`. `scripts/test-webview-guard-startup.sh`
# catches this class of bug.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

# Time allowed for the shell to load and attach and navigate a guest. Generous
# because the build machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# Separate logs for the control run, so it does not overwrite the positive
# run's logs.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-click$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-click$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-click$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-click: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-click: no python3, and the page in the window and the click are both driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits up to `$1` quarter-seconds for `$2` to appear in `$3`.
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
  annotate_from "guard-webview-click: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-click: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"
echo "serving a browser window's page at $SUBJECT"

# 2. Start the engine on a domicile:// page, the only origin WebViewGuestHost
#    is bound for. `--app` matches how `domicile` runs it.
#
#    Clicks go in over `--remote-debugging-port`, since there is no pointer;
#    see guard_webview_devtools.py.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-click.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-click: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-click: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. Wait for the guest page.
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# Hit testing uses submitted compositor frames, and the guest's first frame may
# lag its load, so settle before clicking.
sleep 3

# 4. Click the shell's strip first. If this does not arrive, the harness is
#    broken and later absences mean nothing.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. Click in the guest. The control run skips this.
if [ "$NEGATIVE" != "1" ]; then
  python3 "$SCRIPTS/guard-webview-click-mouse.py" \
    --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the click into the window could not be driven; see $CLICK_LOG" >&2
fi

# `Input.dispatchMouseEvent` returns before the pages handle the event. A fixed
# wait, not a poll, because the control checks for lines that must not appear.
sleep 5

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
# Require `target=webview` so an event from anything else does not count.
SAW_REACHED=$(saw "GUARD window-reached target=webview")
# The ordinary `focusin`, which upstream suppresses here and the fork sends
# anyway. Asserted because focus traps, focus-out dismissal and React's onFocus
# listen for it.
SAW_FOCUSIN=$(saw "GUARD window-focusin target=webview")
# The same event heard at the element. Read only when the document missed it,
# to tell "did not bubble" from "never fired".
SAW_AT_ELEMENT=$(saw "GUARD window-reached-at-element")
SAW_ACTIVE=$(saw "GUARD window-active")
# Which side of the process boundary a missing event is on. A shell window
# blur comes from `FocusController::SetFocusedFrame`, so it means the browser
# told this renderer that focus moved. The guest's window focus asks the same
# from the other side.
SAW_BLUR=$(saw "GUARD shell-window-blur")
SAW_GUEST_FOCUS=$(saw "GUARD guest-window-focus")
# Engine log lines written before and after the dispatch. They tell "never
# dispatched" from "dispatched and unheard" from "a handler did not return".
SAW_ANNOUNCING=$(saw "domicile: a <webview>'s guest took focus")
SAW_ANNOUNCED=$(saw "domicile: announced a <webview>'s guest focus")
# Engine log lines from the fork's branch in SetFocusedFrame, to locate a
# failure before the dispatch: branch not reached, focus refused, or the
# SetFocused override not called.
SAW_BRANCH=$(saw "domicile: focus reached a frame owned by <webview>")
SAW_FOCUSED_IT=$(saw "domicile: focused the <webview> the guest hangs off: 1")
SAW_SET_FOCUSED=$(saw "domicile: <webview> SetFocused received=1")

echo
echo "shell=$SAW_SHELL loaded=$SAW_PAGE"
echo "the shell's document saw: press=$SAW_CHROME reach=$SAW_REACHED active=$SAW_ACTIVE blur=$SAW_BLUR focusin=$SAW_FOCUSIN"
echo "the element itself saw: reach=$SAW_AT_ELEMENT"
echo "the fork's branch said: owner=$SAW_BRANCH focused=$SAW_FOCUSED_IT setfocused=$SAW_SET_FOCUSED"
echo "the engine said: announcing=$SAW_ANNOUNCING announced=$SAW_ANNOUNCED"
echo "the page in the window saw: press=$SAW_GUEST focus=$SAW_GUEST_FOCUS"
echo "where focus went, as this document saw it:"
grep -F "GUARD shell-focus-state" "$ENGINE_LOG" 2>/dev/null | tail -6 | sed 's/^/  /'
echo

# Turn the readings into one verdict naming where the failure is.
# `scripts/test-webview-click-guard.sh` tests this block. Checks run in
# dependency order: a later reading means nothing if an earlier one failed.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so the click was \
never delivered to this browser and every reading below is about a desktop \
nobody touched. This is the harness, not the crossing"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_GUEST" = "1" ]; then
    FAILURE="the control's press landed in the guest, which it was aimed away \
from. The strip and the click are derived from one number here, so this is \
geometry: the window is not the size the run asked for, or the element does \
not start where the strip ends"
  elif [ "$SAW_REACHED" = "1" ] || [ "$SAW_FOCUSIN" = "1" ]; then
    FAILURE="the element was reached with nothing clicked in the guest. Then \
the positive run's reading could be the attach, the load, or a shell focusing \
its own element, and it is not evidence that a press crossed out of a guest"
  else
    PASSED="the control is sharp: a press on the shell's own chrome reaches \
this document and nothing reaches the element, so what the positive run reads \
is the click in the guest and not the configuration"
  fi
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so the press below landed in an \
empty frame. That is the guest: it was not made, not attached, or not \
navigated. The engine's log has the browser's own line for an attach, and the \
http log says whether the page was ever asked for"
elif [ "$SAW_GUEST" != "1" ]; then
  FAILURE="the press never reached the page in the window: it was hit-tested \
to something else, or to nothing. That is this harness or the element's box \
rather than the crossing under test — what crosses is only asked once \
something has landed in the guest"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_AT_ELEMENT" = "1" ]; then
  FAILURE="THE ELEMENT SPOKE AND THE DOCUMENT DID NOT HEAR IT: the event fired \
on the element and never reached the document it is in. That is the event \
itself — it is dispatched as bubbling and a shell listens where this page \
does, on the window it drew, so an event that does not travel is one no chrome \
can be written against"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_ANNOUNCING" = "1" ] &&
  [ "$SAW_ANNOUNCED" != "1" ]; then
  FAILURE="THE DISPATCH WENT IN AND DID NOT COME OUT: the engine announced the \
guest's focus and never finished announcing it, so a listener threw or did not \
return. That is a handler rather than the crossing — the dispatch is \
synchronous and runs inside Document::SetFocusedElement, so whatever the page \
does in it happens with focus bookkeeping halfway through. The engine log has \
the exception"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_ANNOUNCING" = "1" ]; then
  FAILURE="THE ENGINE ANNOUNCED IT AND NOTHING IN THE DOCUMENT HEARD: \
HTMLWebViewElement::DispatchGuestFocus ran, start to finish, and neither the \
element nor the document saw an event. So the crossing works and the event \
does not: the name the engine dispatches and the name this page listens for \
have to be the same string, and WEBVIEW_GUEST_FOCUS_EVENT in the SDK is the \
third copy of it"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_BLUR" = "1" ] &&
  [ "$SAW_BRANCH" != "1" ]; then
  FAILURE="THE FORK'S BRANCH NEVER SAW A <webview>: this renderer was told \
focus moved, and FocusController::SetFocusedFrame did not reach patch 0011's \
branch with a frame a <webview> owns. Either SetFocusedFrame ran with some \
other frame, or the owner did not cast — the branch logs the owner's tag \
either way, so the engine log says which, and if it logged nothing at all the \
branch is not on this path and the element is activeElement by some other \
route"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_BRANCH" = "1" ] &&
  [ "$SAW_FOCUSED_IT" != "1" ]; then
  FAILURE="THE BRANCH RAN AND THE FOCUS WAS REFUSED: patch 0011 found the \
<webview> that owns the guest's frame and Document::SetFocusedElement would \
not take it. That is in Document::SetFocusedElement's own early returns — the \
element not being IsFocusable() at that moment is the first one to read — and \
it is a refusal rather than a missing call, which is a different fix"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_FOCUSED_IT" = "1" ] &&
  [ "$SAW_SET_FOCUSED" != "1" ]; then
  FAILURE="THE ELEMENT WAS FOCUSED AND ITS OVERRIDE DID NOT RUN: \
Document::SetFocusedElement took the <webview> and HTMLWebViewElement's \
SetFocused was never called with it. So the override is not on the path the \
focus took — the base's declaration is what patch 0011 moves into protected, \
and a virtual call that lands on HTMLFrameElementBase instead means the \
signature this overrides is not the one Document calls"
elif [ "$SAW_REACHED" != "1" ] && [ "$SAW_BLUR" = "1" ]; then
  FAILURE="THE DEFECT, ON THIS SIDE OF THE BOUNDARY, AND PAST EVERY STEP THIS \
KNOWS HOW TO ASK ABOUT: the branch ran, the focus took, the override ran with \
received=true, and the announcement inside it never started. So the fault is \
between SetFocused and DispatchGuestFocus, which is two lines of one file — \
or one of the readings above is lying, which is the other thing to check"
elif [ "$SAW_REACHED" != "1" ]; then
  FAILURE="THE DEFECT, ON THE OTHER SIDE: the press landed in the page inside \
the window and this renderer was told nothing at all — no focus on the \
element, and not even the blur that FocusController dispatches on the way \
past. So focus never reached this renderer's FocusController with the guest's \
frame, and no patch in it can be the fix; what is missing is in the browser \
process, between the press and SetFocusedFrameTree. Whether the guest's own \
window took focus (focus= above) says whether it moved there at all"
elif [ "$SAW_FOCUSIN" != "1" ]; then
  FAILURE="THE ELEMENT ANNOUNCED ITSELF AND NO FOCUS EVENT FOLLOWED: \
domicile-guest-focus reached the document and focusin did not, so every \
focus-based handler in a shell -- a popover's focus-out dismissal, a focus \
trap, React's onFocus -- is still blind to a click in a page. \
HTMLWebViewElement::DispatchSuppressedFocus is what sends it, and only while \
the embedder's page is unfocused; the engine log's line from it says whether \
it ran"
elif [ "$SAW_ACTIVE" != "1" ]; then
  PASSED="a press inside a browser window reached the shell's document as a \
focusin on the element the guest hangs off, which is what raises the window. \
WITH ONE READING SHORT: the element was not this document's activeElement \
when that focus arrived, so document.activeElement does not follow a guest's \
focus the way upstream's fenced-frame branch says it should. The shell does \
not read it; something else might"
else
  PASSED="a press inside a browser window reached the shell's document as a \
focusin on the element the guest hangs off, and left that element as \
document.activeElement. That is what BrowserWindow.tsx raises a browser \
window on, and the press that produced it landed in the guest's own page — \
which the same run measured from inside it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-click: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
exit 1
