#!/usr/bin/env bash
# Checks a <webview>'s history controls and the state the element reports
# about its guest: goBack(), goForward(), reload() and stop() must drive the
# guest, and canGoBack/canGoForward, loading state, address, security and
# favicon must follow it. See packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-history.sh /build/chromium/src
#
# Runs headless with software compositing: nothing here is measured in pixels.
#
# A unit test cannot check this. jsdom has no nested browsing context, so
# `BrowserWindow.test.tsx` only shows that Back calls `goBack()`.
#
# The guest's pages, in order. Each page logs its name on `pageshow`, so a
# back/forward-cache restore is reported too (see
# guard-webview-history-server.py):
#
#   /one /two /one /two /two          and no /slow
#    │    │    │    │    │                  │
#    │    │    │    │    │                  stop() canceled the pending load
#    │    │    │    │    reload()
#    │    │    │    goForward()
#    │    │    goBack()
#    │    a second page, so there is history to move in
#    the first page, so the guest exists
#
# canGoBack/canGoForward at four points:
#
#   start          false/false
#   two-pages      true/false    the positive reading; an element answering
#                                false to everything fails here
#   after-back     false/true
#   after-forward  true/false
#
# Loading state at three points:
#
#   settled     false   /two has finished loading
#   pending     true    the fixture is holding /slow open
#   after-stop  false   stop() canceled /slow
#
# `two-pages` is read before the module adds any listener, and must report
# `events=0`. A React shell adds listeners after the first pages commit, so the
# state must be readable without having heard an event.
#
# NEGATIVE=1 is the control: the same shell, element and navigations, with
# none of the four calls. (An <iframe> control would fail on a TypeError, since
# it has no goBack().) The control must show:
#
#   no third page             so the positive run's third page is goBack()'s
#   /slow arrives             so its absence in the positive run is stop()'s
#   back stays available      so the positive run's dead back is goBack()'s
#   no history event          so the positive run's events are the calls'
#   /slow still pending       so `pending` reads a load in flight
#     when read
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
  annotate "guard-webview-history: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 drives none of the four calls. See the header.
NEGATIVE="${NEGATIVE:-0}"
DRIVE="history"
[ "$NEGATIVE" = "1" ] && DRIVE="none"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-history-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-history-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Timings. They depend on each other, so they are set together here. Each step
# advances as soon as its event arrives; SETTLE and STEP are only timeouts.
#
#   SETTLE   timeout for the first page and the last. Must outlast SLOW so the
#            control run sees /slow arrive
#   STEP     timeout for each step in between
#   QUIET    how long the control waits on a step it does not drive. Longer
#            than a healthy step
#   HOLD     how long /slow is pending before stop(), so the request reaches
#            the fixture first
#   SLOW     how long the fixture holds /slow. Must outlast HOLD
SETTLE_MS="${SETTLE_MS:-25000}"
STEP_MS="${STEP_MS:-8000}"
QUIET_MS="${QUIET_MS:-3000}"
HOLD_MS="${HOLD_MS:-2000}"
SLOW_SECONDS="${SLOW_SECONDS:-6}"

# SETTLE + five STEPs + HOLD + SETTLE, plus engine startup, with margin for a
# shared machine.
FOR_SECONDS="${FOR_SECONDS:-240}"

# Separate logs for the control, so it does not overwrite the positive run's.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-history$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-history$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-history: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-history: no python3, and the three pages a guest has a history of are served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages, from a local server: `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-history-server.py" \
  --port 0 --slow-seconds "$SLOW_SECONDS" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-history: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-history: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"
echo "serving a browser window's pages under $SUBJECT"

# 2. The engine, on a domicile:// document: the browser binds
#    WebViewGuestHost only for that origin. `--app` matches how `domicile`
#    runs the engine.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?drive=$DRIVE&src=$SUBJECT&settle=$SETTLE_MS&step=$STEP_MS&quiet=$QUIET_MS&hold=$HOLD_MS" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-history.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD driving" "$ENGINE_LOG" || {
  annotate_from "guard-webview-history: the shell module never ran, so nothing was ever driven" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell is driving mode=$DRIVE"

# 3. The module runs the schedule. Wait for its last line rather than a fixed
#    time, so a slow start still finishes.
wait_for_line "$TRIES" "GUARD done" "$ENGINE_LOG" ||
  echo "the schedule never finished; what follows is a run cut short" >&2

# /slow's absence counts only once it can no longer arrive: the fixture saw the
# browser hang up, or the page arrived. Waits up to SLOW + SETTLE.
slow_settled() {
  grep -qF "abandoned /slow" "$HTTP_LOG" 2>/dev/null ||
    grep -qF "guest-shown path=/slow" "$ENGINE_LOG" 2>/dev/null
}
for _ in $(seq 1 $(((SLOW_SECONDS + SETTLE_MS / 1000) * 4))); do
  slow_settled && break
  sleep 0.25
done

# The pages the guest showed, in order. Each call is checked by its position,
# so an extra navigation is a failure of its own below.
SEQUENCE="$(grep -o 'GUARD guest-shown path=[^ ]*' "$ENGINE_LOG" |
  sed 's/^.*path=//')"
at() { # $1 index
  printf '%s\n' "$SEQUENCE" | sed -n "$1p"
}
FIRST="$(at 1)"
SECOND="$(at 2)"
THIRD="$(at 3)"
FOURTH="$(at 4)"
FIFTH="$(at 5)"
COUNT="$(printf '%s\n' "$SEQUENCE" | grep -c .)"

# canGoBack/canGoForward at each point. `at=` names the point in the schedule,
# not the page, since the control is on a different page by then. `head -1`
# takes the first reading if a point is logged twice.
STATES="$(grep -o 'GUARD history-state at=[^ ]* can=[^ ]* events=[0-9]*' \
  "$ENGINE_LOG")"
can_at() { # $1 point
  printf '%s\n' "$STATES" |
    sed -n "s/^GUARD history-state at=$1 can=\([^ ]*\) .*\$/\1/p" | head -1
}
# History events heard by that point. Zero at `two-pages` is expected: see the
# header.
events_at() { # $1 point
  printf '%s\n' "$STATES" |
    sed -n "s/^GUARD history-state at=$1 .* events=\([0-9]*\)\$/\1/p" | head -1
}
START_CAN="$(can_at start)"
TWO_CAN="$(can_at two-pages)"
TWO_EVENTS="$(events_at two-pages)"
BACK_CAN="$(can_at after-back)"
FORWARD_CAN="$(can_at after-forward)"
FORWARD_EVENTS="$(events_at after-forward)"

# Loading state at each point. Separate from history state: either can change
# without the other.
LOADINGS="$(grep -o 'GUARD loading-state at=[^ ]* loading=[^ ]* events=[0-9]*' \
  "$ENGINE_LOG")"
loading_at() { # $1 point
  printf '%s\n' "$LOADINGS" |
    sed -n "s/^GUARD loading-state at=$1 loading=\([^ ]*\) .*\$/\1/p" | head -1
}
loading_events_at() { # $1 point
  printf '%s\n' "$LOADINGS" |
    sed -n "s/^GUARD loading-state at=$1 .* events=\([0-9]*\)\$/\1/p" | head -1
}
SETTLED_LOADING="$(loading_at settled)"
PENDING_LOADING="$(loading_at pending)"
PENDING_LOADING_EVENTS="$(loading_events_at pending)"
STOPPED_LOADING="$(loading_at after-stop)"

# The address and connection security the element reports at each point.
PAGES="$(grep -o 'GUARD page-state at=[^ ]* path=[^ ]* security=[^ ]*' \
  "$ENGINE_LOG")"
path_at() { # $1 point
  printf '%s\n' "$PAGES" |
    sed -n "s/^GUARD page-state at=$1 path=\([^ ]*\) .*\$/\1/p" | head -1
}
security_at() { # $1 point
  printf '%s\n' "$PAGES" |
    sed -n "s/^GUARD page-state at=$1 .* security=\([^ ]*\)\$/\1/p" | head -1
}
TWO_PATH="$(path_at two-pages)"
TWO_SECURITY="$(security_at two-pages)"
# The favicon the page links, which a launcher uses for a bookmark's icon.
# Read at /two, which links /two.png. Console lines are logged as
# `"GUARD ...", source: ...`, so the path ends at a quote or a space.
favicon_at() { # $1 point
  grep -o "GUARD favicon-state at=$1 path=[^ \"]*" "$ENGINE_LOG" |
    sed -n 's/^.* path=//p' | head -1
}
TWO_FAVICON="$(favicon_at two-pages)"
BACK_PATH="$(path_at after-back)"
FORWARD_PATH="$(path_at after-forward)"

SAW_MODULE=$(grep -qF "GUARD driving" "$ENGINE_LOG" && echo 1 || echo 0)
SAW_SLOW_SHOWN=$(printf '%s\n' "$SEQUENCE" | grep -qx "/slow" && echo 1 || echo 0)
# The fixture logs a request on arrival, so this is true in the positive run
# too. It separates "stop() canceled /slow" from "/slow was never requested".
SAW_SLOW_ASKED=$(grep -qF "asked /slow" "$HTTP_LOG" && echo 1 || echo 0)

echo
echo "the guest showed: $(printf '%s' "$SEQUENCE" | tr '\n' ' ')"
echo "module=$SAW_MODULE pages=$COUNT slow-asked=$SAW_SLOW_ASKED slow-shown=$SAW_SLOW_SHOWN"
echo "the element said: start=$START_CAN two-pages=$TWO_CAN after-back=$BACK_CAN after-forward=$FORWARD_CAN"
echo "history events: at two-pages=$TWO_EVENTS at after-forward=$FORWARD_EVENTS"
echo "and it was showing: two-pages=$TWO_PATH after-back=$BACK_PATH after-forward=$FORWARD_PATH"
echo "with security: at two-pages=$TWO_SECURITY"
echo "and it was loading: settled=$SETTLED_LOADING pending=$PENDING_LOADING after-stop=$STOPPED_LOADING"
echo "loading events: at pending=$PENDING_LOADING_EVENTS"
echo

# The verdict. `scripts/test-webview-history-guard.sh` runs this block
# directly. Checks are ordered by dependency, so each failure names the first
# layer that broke: with no second page, "did not go back" would blame the
# wrong layer.
FAILURE=""
PASSED=""
if [ "$SAW_MODULE" != "1" ]; then
  FAILURE="the shell module never ran, so nothing here was ever driven. This \
is the harness: the page did not load, or its query was wrong, and the engine \
log has its console"
elif [ "$FIRST" != "/one" ]; then
  FAILURE="the window never showed its first page, so there is no guest here \
to have a history. That is the guest and not the controls: it was not made, \
not attached, or not navigated. The engine's log has the browser's own line \
for an attach, and the http log says whether the page was ever asked for"
elif [ "$SECOND" != "/two" ]; then
  FAILURE="the window showed one page and never a second, so there was no \
history to move in and nothing below is a measurement. The element's own \
src attribute is what drives that navigation, so this is Navigate rather than \
any of the four"
elif [ "$TWO_PATH" != "/two" ]; then
  FAILURE="the guest was showing /two and the element said it was showing \
\"$TWO_PATH\". THIS IS THE ADDRESS CLAIM: the element reports the guest's \
visible entry, pushed from the browser, and a chrome that cannot read it shows \
the user the page they left. An empty reading is the browser never having sent \
PageChanged; a stale one is it having sent the wrong entry"
elif [ "$TWO_FAVICON" != "/two.png" ]; then
  FAILURE="the guest was showing /two, whose page links /two.png, and the \
element named \"$TWO_FAVICON\" as the icon the page links. An empty reading \
is the browser never having sent FaviconChanged; /one.png is it having sent \
the last page's. Either way a chrome learning a site's icon from its own \
signed-in page would draw it with the wrong one, or none"
elif [ "$TWO_SECURITY" = "" ] || [ "$TWO_SECURITY" = "undefined" ]; then
  FAILURE="the element reported no security for a page that had committed, \
which is what an engine with no verdict to give looks like from a chrome: \
\"$TWO_SECURITY\". A browser window draws its padlock from this, and a chrome \
that reads nothing here can only draw nothing — or, worse, fall back to \
guessing from the scheme. This is WebViewGuest::ReportPage and the \
security_state call inside it"
elif [ "$NEGATIVE" = "1" ]; then
  if [ -n "$THIRD" ] && [ "$THIRD" != "/slow" ]; then
    FAILURE="the guest showed a third page ($THIRD) with nothing driving it. \
Something here moves a window on its own — a redirect, a reload, a second \
send of the same src — which means the positive run's third page need not \
have come from goBack() and this pair decides nothing"
  elif [ "$SAW_SLOW_ASKED" != "1" ]; then
    FAILURE="the last navigation never reached the server. This is the \
harness: the schedule did not get that far, so the slow page is untested in \
BOTH runs and the positive run's reading of stop() rests on nothing"
  elif [ "$SAW_SLOW_SHOWN" != "1" ]; then
    FAILURE="the slow page never arrived even with nothing stopping it. The \
positive run reads stop() as that page's absence, so without it here that \
absence measures the fixture rather than stop(). Check --slow-seconds against \
the schedule: a page still in flight when the run ends looks exactly like a \
canceled one"
  elif [ "$COUNT" != "3" ]; then
    FAILURE="the guest showed $COUNT pages where the control drove two and \
then the slow one. Every reading in the positive run is a position in that \
sequence, so a run with pages nobody asked for shifts all of them"
  elif [ "$TWO_CAN" != "true/false" ]; then
    FAILURE="the element never became available to go back, even with a page \
behind it: at two pages it said \"$TWO_CAN\" where back is live and forward \
is not. Every absence this guard reads rests on that, in both runs, so \
nothing below it is a measurement"
  elif [ "$BACK_CAN" != "true/false" ]; then
    FAILURE="the guest's history went dead on its own: with nothing driving \
it the element said \"$BACK_CAN\" where it had said \"$TWO_CAN\". Something \
here moves or prunes a guest's history unasked, which means the positive \
run's dead back need not have been goBack()'s and this pair decides nothing"
  elif [ "$FORWARD_EVENTS" != "0" ]; then
    FAILURE="the element announced $FORWARD_EVENTS history change(s) with \
nothing driving it. The positive run reads its two as the two calls, so a run \
that pushes unasked makes that count noise — a navigation the fixture caused, \
a second send of the same src, or a push that does not check whether anything \
changed"
  elif [ "$SETTLED_LOADING" != "false" ]; then
    FAILURE="the element said \"$SETTLED_LOADING\" where a page given a whole \
step to arrive is not arriving any more. Nothing was driven at this run, so \
this is the browser's own answer stuck on — and the positive run's settled \
reading measures the same thing"
  elif [ "$PENDING_LOADING" != "true" ]; then
    FAILURE="the slow navigation was not still in flight when it was read: \
the element said \"$PENDING_LOADING\" with the fixture holding that page \
open and nothing having stopped it. So the positive run's pending reading is \
not about a load in flight either — check --slow-seconds against the schedule"
  else
    PASSED="the control is sharp: the same element, the same guest and the \
same navigations with none of the four called show no third page — so the \
positive run's is goBack()'s — the slow page arrives, so the positive run's \
not showing it is stop(), and back stays available with no event behind it, \
so the positive run's dead back and its two events are the calls"
  fi
elif [ "$THIRD" != "/one" ]; then
  FAILURE="goBack() did not take the guest back. THIS IS THE CLAIM: the guest \
has a NavigationController of its own in the browser process, and either the \
call never reached it or it reached the placeholder frame's History as it did \
before. What the guest showed instead was \"$THIRD\""
elif [ "$BACK_PATH" != "/one" ]; then
  FAILURE="the guest went back to /one and the element said it was showing \
\"$BACK_PATH\". THIS IS THE CLAIM THE WHOLE PAGE REPORT EXISTS FOR: nothing \
in the shell navigated here — goBack() moved the guest's own controller in the \
browser process — so an element that still names the old page is a chrome that \
cannot follow its own window. A padlock drawn beside that address would be \
describing a page the user is not on"
elif [ "$FOURTH" != "/two" ]; then
  FAILURE="goForward() did not take the guest forward. goBack() worked, so \
the pipe is reaching the browser and the guest has the entries — this is \
GoForward on the controller, or a back that left no forward entry to return \
to. What the guest showed instead was \"$FOURTH\""
elif [ "$FORWARD_PATH" != "/two" ]; then
  FAILURE="the guest went forward to /two and the element said it was showing \
\"$FORWARD_PATH\". goBack() was followed, so the report is not dead — this is \
one direction of it, which is a browser sending PageChanged for some entry \
changes and not others"
elif [ "$FIFTH" != "/two" ]; then
  FAILURE="reload() showed nothing again. The page was already on screen, so \
what is missing is the fresh load: nothing arrived and no pageshow fired, \
which is what reload() not reaching the guest's controller looks like"
elif [ "$START_CAN" != "false/false" ]; then
  FAILURE="the element said the first page of a history had somewhere to go: \
\"$START_CAN\" where both are false. A guest that has been one place has no \
entry behind it and none ahead, so this is the browser's answer arriving \
wrong or the element holding somebody else's"
elif [ "$TWO_CAN" != "true/false" ]; then
  FAILURE="the element never became available to go back, even with a page \
behind it: at two pages it said \"$TWO_CAN\" where back is live and forward \
is not. THIS IS THE POSITIVE the rest of the readings rest on — an element \
answering no to everything would satisfy every absence below — so it is the \
browser's push, the client pipe, or CanGoBack() itself"
elif [ "$TWO_EVENTS" != "0" ]; then
  FAILURE="the two-pages reading was taken by an element that had already \
heard $TWO_EVENTS history change(s), and that is the one reading which has to \
be taken with no listener on it. It is what says a chrome mounting late reads \
the state rather than having needed the event, and an element that had \
listened says nothing of the sort. The module attaches its listener straight \
after this reading; if that moved, move this with it"
elif [ "$BACK_CAN" != "false/true" ]; then
  FAILURE="goBack() left the element saying \"$BACK_CAN\" where back is \
spent and forward is earned. The guest DID go back — the page order above \
says so — so this is the browser not pushing the new answer, or pushing one \
that does not match the controller it just drove"
elif [ "$FORWARD_CAN" != "true/false" ]; then
  FAILURE="goForward() left the element saying \"$FORWARD_CAN\" where the \
forward entry is spent and the back one is earned again. The guest moved, so \
what is wrong is the answer that followed it"
elif [ "$FORWARD_EVENTS" = "0" ] || [ -z "$FORWARD_EVENTS" ]; then
  FAILURE="the element never announced a history change, so a chrome has \
nothing to re-read on. The values themselves are right, which makes this the \
half a shell cannot do without rather than the half it renders from: an \
address bar would show the state its first render happened to catch and never \
move again"
elif [ "$SAW_SLOW_ASKED" != "1" ]; then
  FAILURE="the last navigation never reached the server, so there was no \
pending load for stop() to cancel and its reading below is about a navigation \
that never started. This is the harness"
elif [ "$SETTLED_LOADING" != "false" ]; then
  FAILURE="the element said \"$SETTLED_LOADING\" where a page given a whole \
step to arrive is no longer arriving. This is the half of the loading claim \
that catches an element answering yes to everything, so nothing below it is a \
measurement: it is the browser never reporting the load finishing, or the \
element never storing that it did"
elif [ "$PENDING_LOADING" != "true" ]; then
  FAILURE="the element never said a page was on its way: with the fixture \
holding /slow open it said \"$PENDING_LOADING\". THIS IS THE POSITIVE the \
loading readings rest on — an element answering no to everything satisfies \
both absences around it — so it is the browser's push, the client pipe, or \
should_show_loading_ui and IsLoading() disagreeing about a load that has \
plainly started"
elif [ "$PENDING_LOADING_EVENTS" = "0" ] || [ -z "$PENDING_LOADING_EVENTS" ]; then
  FAILURE="the element never announced that its loading state changed, so a \
chrome has nothing to re-read on. The value itself is right, which makes this \
the half a shell cannot do without rather than the half it renders from: an \
address bar would show whatever its first render caught and never move again"
elif [ "$SAW_SLOW_SHOWN" = "1" ]; then
  FAILURE="the slow page arrived anyway, so stop() canceled nothing. The \
fixture sits on that navigation for ${SLOW_SECONDS}s and stop() was driven \
inside it, which is the only window in which a stop is a stop"
elif [ "$STOPPED_LOADING" != "false" ]; then
  FAILURE="stop() canceled the navigation — the slow page never arrived — and \
the element went on saying \"$STOPPED_LOADING\". So a browser window that \
stops a load keeps a spinner turning over a page that is not coming: the \
browser reports a canceled load like any other finished one, and this is that \
report not arriving or not being stored"
elif [ "$COUNT" != "5" ]; then
  FAILURE="the guest showed $COUNT pages where five were driven. Every \
reading here is a position in that sequence, so pages nobody asked for shift \
all of them — and the readings above happened to line up anyway, which is \
worse than them not"
else
  PASSED="a <webview>'s four history controls drive the guest: it went back \
to the page before, forward to the one after, reloaded it into a fresh load, \
and stop() canceled a navigation that would otherwise have landed. And the \
element says what back and forward can do at each step — read at two pages \
with no listener on it, which is what a chrome mounting late would read — \
with an event behind every change for one to re-read on. It also tells a page \
that has arrived from one still on its way, and stops saying so the moment \
the load is canceled"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-history: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
