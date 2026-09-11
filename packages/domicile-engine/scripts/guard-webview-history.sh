#!/usr/bin/env bash
# The four history controls of a <webview>, driven at the guest behind it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-history.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-framing.sh
# and guard-webview-keyboard.sh run: nothing here is measured in pixels, so
# `--ozone-platform=headless` with software compositing is the whole of the
# environment.
#
# WHY THIS EXISTS. A <webview> hosts a guest — an inner WebContents attached to
# a placeholder child frame — and `goBack()`, `goForward()`, `stop()` and
# `reload()` reached that PLACEHOLDER's History, which has been on about:blank
# since it was made. So all four did nothing at all, and a shell's address bar
# drove a page nobody was looking at. The guest's own NavigationController is
# in the browser process, and wiring the four to it over the WebViewGuest pipe
# is what this asserts.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM. There is no nested browsing context in
# jsdom, so there is no history for anything to move in and no page to observe
# moving; `BrowserWindow.test.tsx` asserts that pressing Back calls `goBack()`
# on the element and would keep passing with this whole path removed. The claim
# is "the page in the window went back to the page before it", and only a real
# engine can be asked it.
#
# THE POSITIVE IS ESTABLISHED FIRST, which is the lesson the other two guards
# learned the hard way: a guard that measures only an absence proves nothing,
# because "nothing happened" and "the harness is broken" read the same from
# inside. So this navigates somewhere, confirms it, navigates somewhere else,
# confirms that, and only then goes back — and what it asserts is the ORDER of
# the pages the guest showed:
#
#   /one /two /one /two /two          and no /slow
#    │    │    │    │    │                  │
#    │    │    │    │    │                  stop() cancelled the pending one
#    │    │    │    │    reload() fetched the page again
#    │    │    │    goForward() returned to it
#    │    │    goBack() — THE CLAIM
#    │    a second page, so there is a history to move in
#    the first page, so there is a guest showing anything at all
#
# Each page says its own name on `pageshow`, which is what makes a
# back/forward-cached restore reportable at all; see
# guard-webview-history-server.py.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without.
# NEGATIVE=1 runs the same shell, the same element, the same guest and the same
# two navigations, and CALLS NOTHING. Not an <iframe> in the element's place,
# which is what the other two <webview> guards use: an <iframe> has no goBack()
# at all, so that run would end on a TypeError rather than on a reading. What
# this control removes is the four calls, and it decides two things the
# positive run cannot see from the inside:
#
#   a third page must NOT appear    or a guest moves back to a page it has
#                                    shown without anybody driving it, and the
#                                    positive run's third line is not goBack()
#   the slow page MUST appear       or the fixture never answers, and the
#                                    positive run's not showing it is a
#                                    measurement of nothing rather than of
#                                    stop()
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-history: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 drives none of the four. See the header.
NEGATIVE="${NEGATIVE:-0}"
DRIVE="history"
[ "$NEGATIVE" = "1" ] && DRIVE="none"

# Not the framing guard's 8731, not the keyboard guard's 8732 and not the port
# `scripts/test-webview-history-server.sh` takes: two guards on one number is
# two guards that cannot run in the same job, and CI runs them in one.
PORT="${PORT:-8733}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-history-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-history-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# THE THREE NUMBERS THE EXPERIMENT IS MADE OF, and they are one file's to pick
# because they only work together.
#
#   SETTLE   the first page's runway and the last page's grace. Long, because
#            everything before the first page is asynchronous — the element
#            asks for a guest, the browser prepares the placeholder, attaches
#            an inner WebContents and only then navigates — and because a page
#            that must NOT arrive has to be given longer than it would have
#            taken to arrive
#   STEP     how long each control gets to land before the next is driven
#   SLOW     how long the fixture sits on the last navigation. It must outlast
#            STEP, so that stop() is driven while the load is still pending,
#            and be outlasted by SETTLE, so that the control run sees the page
#            it would have shown
SETTLE_MS="${SETTLE_MS:-25000}"
STEP_MS="${STEP_MS:-8000}"
SLOW_SECONDS="${SLOW_SECONDS:-20}"

# The schedule is SETTLE + five STEPs + SETTLE, and the engine has to start
# before any of it. Generous on top of that, because this machine is shared.
FOR_SECONDS="${FOR_SECONDS:-240}"

# A run and its own control are two measurements, so they get two sets of logs.
# Sharing one file means the control's output overwrites the run's and the
# diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-history$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-history$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
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

# Waits for `$2` to appear in `$3`, for `$1` quarter seconds. Every gate in this
# script is a line in a log, because every one of them is something a page or a
# browser says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The three pages. Their own server rather than real sites, for the reason
#    the framing guard has one: `crux` reaches no arbitrary host.
python3 "$SCRIPTS/guard-webview-history-server.py" \
  --port "$PORT" --slow-seconds "$SLOW_SECONDS" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-history: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"
echo "serving a browser window's pages under $SUBJECT"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other — a <webview> anywhere else
#    cannot ask for a guest at all. `--app` for the reason `domicile` uses it
#    and every guard here repeats: the guard runs the configuration the product
#    runs, or it is guarding something else.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?drive=$DRIVE&src=$SUBJECT&settle=$SETTLE_MS&step=$STEP_MS" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-history.js" \
  --no-sandbox --password-store=basic --no-first-run \
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

# 3. The whole schedule, which the module owns. Waiting on its last line rather
#    than sleeping for the arithmetic: a browser that started slowly still
#    finishes, and one that died says so by never getting here.
wait_for_line "$TRIES" "GUARD done" "$ENGINE_LOG" ||
  echo "the schedule never finished; what follows is a run cut short" >&2

# The pages the guest showed, in the order it showed them. That sequence is the
# entire measurement: every one of the four controls is read as a position in
# it, so an extra navigation anywhere would shift the rest and is a failure of
# its own below.
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

SAW_MODULE=$(grep -qF "GUARD driving" "$ENGINE_LOG" && echo 1 || echo 0)
SAW_SLOW_SHOWN=$(printf '%s\n' "$SEQUENCE" | grep -qx "/slow" && echo 1 || echo 0)
# Asked for, which is not the same as answered: the fixture records a request
# when it ARRIVES, so this is true in the positive run too — the navigation
# started and was cancelled. Without it, "the slow page never appeared" and
# "the element never went there" are the same reading.
SAW_SLOW_ASKED=$(grep -qF "asked /slow" "$HTTP_LOG" && echo 1 || echo 0)

echo
echo "the guest showed: $(printf '%s' "$SEQUENCE" | tr '\n' ' ')"
echo "module=$SAW_MODULE pages=$COUNT slow-asked=$SAW_SLOW_ASKED slow-shown=$SAW_SLOW_SHOWN"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgement. Six
# readings and two modes make far more answers than a person reading an
# annotation can be expected to reconstruct, and most of the failures read
# alike and mean different things — so they are decided here, in a block
# `scripts/test-webview-history-guard.sh` runs directly, rather than inferred
# from a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in: a run where no
# second page ever loaded has no history for anything to move in, so "the page
# did not go back" would be a true sentence about the wrong layer.
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
cancelled one"
  elif [ "$COUNT" != "3" ]; then
    FAILURE="the guest showed $COUNT pages where the control drove two and \
then the slow one. Every reading in the positive run is a position in that \
sequence, so a run with pages nobody asked for shifts all of them"
  else
    PASSED="the control is sharp: the same element, the same guest and the \
same navigations with none of the four called show no third page — so the \
positive run's is goBack()'s — and the slow page arrives, so the positive \
run's not showing it is stop()"
  fi
elif [ "$THIRD" != "/one" ]; then
  FAILURE="goBack() did not take the guest back. THIS IS THE CLAIM: the guest \
has a NavigationController of its own in the browser process, and either the \
call never reached it or it reached the placeholder frame's History as it did \
before. What the guest showed instead was \"$THIRD\""
elif [ "$FOURTH" != "/two" ]; then
  FAILURE="goForward() did not take the guest forward. goBack() worked, so \
the pipe is reaching the browser and the guest has the entries — this is \
GoForward on the controller, or a back that left no forward entry to return \
to. What the guest showed instead was \"$FOURTH\""
elif [ "$FIFTH" != "/two" ]; then
  FAILURE="reload() showed nothing again. The page was already on screen, so \
what is missing is the fresh load: nothing arrived and no pageshow fired, \
which is what reload() not reaching the guest's controller looks like"
elif [ "$SAW_SLOW_ASKED" != "1" ]; then
  FAILURE="the last navigation never reached the server, so there was no \
pending load for stop() to cancel and its reading below is about a navigation \
that never started. This is the harness"
elif [ "$SAW_SLOW_SHOWN" = "1" ]; then
  FAILURE="the slow page arrived anyway, so stop() cancelled nothing. The \
fixture sits on that navigation for ${SLOW_SECONDS}s and stop() was driven \
inside it, which is the only window in which a stop is a stop"
elif [ "$COUNT" != "5" ]; then
  FAILURE="the guest showed $COUNT pages where five were driven. Every \
reading here is a position in that sequence, so pages nobody asked for shift \
all of them — and the readings above happened to line up anyway, which is \
worse than them not"
else
  PASSED="a <webview>'s four history controls drive the guest: it went back \
to the page before, forward to the one after, reloaded it into a fresh load, \
and stop() cancelled a navigation that would otherwise have landed"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-history: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
