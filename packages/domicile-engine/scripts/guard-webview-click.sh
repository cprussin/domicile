#!/usr/bin/env bash
# A click inside a browser window, and whether the shell around it is told.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-click.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-framing.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. Clicking a window raises it, in every desktop there is, and
# a browser window is the one kind Domicile cannot raise that way on its own:
# the page in it is a guest with a browsing context of its own, so no pointer
# event inside it crosses back out to the shell. Every other window is raised
# by the compositor saying where the keyboard went; a browser window's page
# never moves it, because that page is inside the chrome's own window.
#
# What was left to cross was the focus the press takes — and it does not.
# Upstream Blink says so in `FocusController::SetFocusedFrame`'s own words:
# "for cross-origin (remote) frames, DOM focus events do not cross process
# boundaries to reach the frame owner element in the parent document". A guest
# is exactly such a frame, so the shell heard nothing, and clicking into a
# browser window left it under whatever was covering it with the rail still
# highlighting the window before it.
#
# THE FORK ANSWERS IT IN TWO PARTS, AND THIS GUARD IS WHY IT IS TWO. Patch 0011
# gives the element the focus its guest took, the way upstream already does for
# a fenced frame — and the first run of this guard, with only that, still read
# `reach=0`: focusing the element buys `document.activeElement` and not one
# event, because `Document::SetFocusedElement` dispatches focus events only
# while the page is focused ("if page lost focus, event will be dispatched on
# page focus, don't duplicate") and a guest taking focus is precisely the moment
# the embedder's page has lost it. So the element says so itself, in an event
# that is not a focus event, and that is what this asserts.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM, and a unit test is what let the defect
# ship: there is no nested browsing context in happy-dom, so a test that
# dispatches the event itself passes in `BrowserWindow.test.tsx` whether or not
# anything real ever sends one. What that test asserts is the shell's half —
# that an arriving event raises the window — and only a real engine can be
# asked whether one arrives.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   the shell page ran                 or nothing here was ever set up
#   a press reached the shell's        the harness can deliver a click to this
#     document                          document at all. Without it, an absence
#                                       below is not a measurement
#   there is a page in the window      that a guest was made, attached and
#                                       navigated
#   the press landed in the guest      measured in the window's own page: the
#                                       hit test crossed into it rather than
#                                       stopping at the element
#   the shell's document was told      THE CLAIM: the element saying its guest
#                                       took focus, which is what
#                                       `BrowserWindow.tsx` raises a window on
#   the element is activeElement       the other half of what the patch is for,
#                                       and what upstream's fenced-frame branch
#                                       names as its reason
#
# AND TWO READINGS THAT ARE NOT ASSERTIONS, which exist so that a FAILING run
# names a side rather than a symptom. "No focus arrived" has two causes that
# read identically: the browser never told this renderer that focus moved, or
# it did and nothing came of it in the element. The shell document's own window
# `blur` separates them — `FocusController::SetFocusedFrame` dispatches it a
# dozen lines past the fork's branch, so it cannot happen unless that function
# ran here with the guest's frame. The guest page's own window `focus` asks the
# same question from the far end. Neither decides a pass; both decide where the
# next person looks.
#
# AND TWO THE ENGINE WRITES ITSELF, for the layer no listener can report.
# Every reading above is something a document said, so when the element never
# announces anything they all go quiet at once — and "SetFocused never ran",
# "it ran and the page heard nothing" and "a handler never returned" become one
# symptom in three layers. HTMLWebViewElement::DispatchGuestFocus brackets its
# dispatch with a line either side, and those two separate all three. Engine
# run 192 is why they exist: it read the element as activeElement with no event
# anywhere, which said where the fault was not and nothing about where it was.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without.
# NEGATIVE=1 runs the same desktop and clicks the shell's own strip instead of
# the window below it. Nothing may then be reported from the guest and nothing
# may reach the element — which separates "a press in the guest crossed out"
# from "this element ends up focused in this configuration whatever anyone
# clicks", the second of which would pass the positive run while measuring the
# attach, the load, or a shell that focuses its own element.
#
# NOT AN <iframe> IN THE ELEMENT'S PLACE, which is the control the keyboard
# guard uses and the wrong one here. An ordinary subframe on a domicile://
# document loads no http page, so it stays same-process and about:blank — and a
# same-process frame's focus DOES reach its owner, by the same Blink code that
# says a remote one's does not. A control that fired every time would decide
# nothing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-click: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 clicks the shell's strip instead of the window. See the header.
NEGATIVE="${NEGATIVE:-0}"

# Not spike-iframe.sh's 8730, the framing guard's 8731, the keyboard guard's
# 8732 or the history guard's 8733: two guards on one port is two guards that
# cannot run in the same job, and CI runs them in one. This guard did take 8733
# while it was written -- the history guard landed on main with the same number
# in the window between, and a rebase merges two files that never touched.
PORT="${PORT:-8734}"
DEBUG_PORT="${DEBUG_PORT:-9233}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-click-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-click-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# The shell's own half of the window, in CSS pixels down from the top. The two
# points the guard clicks are derived from it rather than written down, so the
# strip and the presses cannot drift apart: one in the middle of the strip, one
# well inside the window below it.
#
# NOT `STRIP`, WHICH IS A PROGRAM. This runs inside `nix develop .#full`, and
# that shell exports the toolchain's own names -- CC, LD, AR, STRIP. `${STRIP:-64}`
# in such a shell keeps `strip`, and the arithmetic below then dereferences it
# as a variable and dies under `set -u`, four hours into a job on the shared
# tree. `scripts/test-webview-guard-startup.sh` is what starts every guard here
# in that environment so the next one fails on this machine instead.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

# How long the shell is given to load, ask for a guest, have one attached and
# navigated. Generous, because every one of those is asynchronous and this
# machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its own negative control are two measurements, so they get two sets
# of logs. Sharing one file means the control's output overwrites the run's and
# the diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
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

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds. Every gate in this
# script is a line in a log, because every one of them is something a page or a
# browser says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows. Its own server rather than a real site,
#    for the reason the framing guard has one: `crux` reaches no arbitrary host.
python3 "$SCRIPTS/guard-webview-guest-page.py" --port "$PORT" \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-click: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"
echo "serving a browser window's page at $SUBJECT"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other. `--app` for the reason
#    `domicile` uses it and every guard here repeats: the guard runs the
#    configuration the product runs, or it is guarding something else.
#
#    `--remote-debugging-port` is how the click gets in. There is no pointer on
#    this machine; see guard_webview_devtools.py for why the path it takes is
#    the one the platform's own press would take.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-click.js" \
  --remote-debugging-port="$DEBUG_PORT" \
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
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. There has to be a page in the window before a click in it means anything.
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# A press is routed by hit test, and a hit test is answered from the compositor
# frames the widgets have submitted. The line above says the guest's page ran,
# which is not the same as its first frame having reached the browser — so a
# settle, rather than clicking at the moment the page spoke.
sleep 3

# 4. THE BEFORE. A press on the shell's own strip, which this document must
#    report — and which is what turns the absences below into measurements: a
#    run where no click reaches this page at all reads exactly like a run where
#    one did and nothing crossed.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. THE CLICK THIS GUARD IS ABOUT: inside the window, where the guest is. Not
#    driven at all in the control run — that is the control.
if [ "$NEGATIVE" != "1" ]; then
  python3 "$SCRIPTS/guard-webview-click-mouse.py" \
    --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the click into the window could not be driven; see $CLICK_LOG" >&2
fi

# The press is answered before it is handled: `Input.dispatchMouseEvent` comes
# back when the event has been forwarded, and what this reads is what the pages
# logged afterwards. A fixed wait rather than a poll on the line that must
# appear, because the control's readings are ABSENCES, and an absence cannot be
# waited for — it can only be given time.
sleep 5

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
# `target=webview` and not merely an event: the strip and the body dispatch
# nothing, so a reach reported about anything else in this document would be a
# reading about something other than the window.
SAW_REACHED=$(saw "GUARD window-reached target=webview")
# The focus event that is NOT how this works, kept as a reading: it is
# suppressed because the embedder's page has lost focus by the time the element
# is focused, and a run where it starts arriving is a run where the engine
# changed under this.
SAW_FOCUSIN=$(saw "GUARD window-focusin target=webview")
# The claim's own event heard at the element instead of at the document. Only
# ever read when the claim is missing, and then it is the whole difference
# between a dispatch that did not travel and one that did not happen.
SAW_AT_ELEMENT=$(saw "GUARD window-reached-at-element")
SAW_ACTIVE=$(saw "GUARD window-active")
# WHICH SIDE OF THE PROCESS BOUNDARY A MISSING REACH IS ON, and the only pair
# of readings that can say. The shell document's window is blurred by
# `FocusController::SetFocusedFrame` itself, a dozen lines past the fork's
# branch -- so a blur means the browser DID tell this renderer that focus moved
# and the branch is where to look, and no blur means it never told it and no
# renderer-side patch can be the answer. The guest's own window focus is the
# same question asked from the far end.
SAW_BLUR=$(saw "GUARD shell-window-blur")
SAW_GUEST_FOCUS=$(saw "GUARD guest-window-focus")
# AND THE ENGINE'S OWN TWO LINES, which are the readings the page cannot give.
# Every reading above is something a listener in a document said, so all of
# them go quiet together when the element never announces anything -- and
# "HTMLWebViewElement::SetFocused never ran" then reads exactly like "it ran
# and the page heard nothing", in two different layers. These bracket the
# dispatch: the first is written before it and the second after it.
SAW_ANNOUNCING=$(saw "domicile: a <webview>'s guest took focus")
SAW_ANNOUNCED=$(saw "domicile: announced a <webview>'s guest focus")
# AND THE TWO STEPS BEFORE THAT, for the same reason one step further back.
# Run 193 read the element as activeElement with announcing=0, which says
# SetFocused did not run on this subclass and says nothing about why: the
# fork's branch in SetFocusedFrame may never have run, the owner may not have
# cast to a <webview>, Document::SetFocusedElement may have refused, or the
# override may not be on the path at all. These are the branch saying so.
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

# WHICH END TO BLAME, and it is the whole of this script's judgement. Six
# readings and two modes make more answers than a person reading an annotation
# can be expected to reconstruct, and most of the failures read alike and mean
# different things — so they are decided here, in a block
# `scripts/test-webview-click-guard.sh` runs directly, rather than inferred from
# a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in: a run where the
# page never ran has established nothing, and a run where no press reached this
# document is not a run about what crosses into it.
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
  elif [ "$SAW_REACHED" = "1" ]; then
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
tail -40 "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
exit 1
