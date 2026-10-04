#!/usr/bin/env bash
# Tests the verdict of `guard-webview-history.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered because readings depend on each other: with no
# second page there is no history to go back in. Easy to get backward:
#
#   - In the control, a third page is the failure: nothing drove it, so the
#     positive run's third page might not come from goBack().
#   - In the control, the slow page not arriving is the failure. It proves the
#     positive run's missing slow page comes from stop(), not a fixture that
#     never answers.
#   - A slow page the server never received fails both runs.
#   - In the control, `back` staying available passes and going dead fails.
#   - In the control, any event is a failure; the positive run reads its two
#     events as the two calls.
#   - A two-pages `can` reading taken after an event fails even if correct: it
#     must show the state is readable before any listener existed.
#   - In the control, the slow navigation must still be pending where read,
#     so the positive run's pending reading is a load in flight.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-history.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the column-zero `fi` that ends the decision. Nested
# `fi`s are indented.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# Sets every reading to its passing value; each case overrides one by name,
# which reads better than positional arguments.
#
# The modes have different baselines: the positive run drives five
# navigations, the control two and then the slow one.
baseline() { # $1 NEGATIVE
  SAW_MODULE=1
  SAW_SLOW_ASKED=1
  # Not a reading: the fixture's delay, quoted by one failure message.
  SLOW_SECONDS=20
  NEGATIVE="$1"
  # Shared: neither run has driven anything yet. The first page can go
  # nowhere, and no listener has been attached.
  START_CAN="false/false"
  TWO_CAN="true/false"
  TWO_EVENTS=0
  # Shared: `two-pages` is read before either run drives anything.
  TWO_PATH="/two"
  TWO_SECURITY="neutral"
  # The icon the page links, by path. Shared for the same reason.
  TWO_FAVICON="/two.png"
  # Shared: a finished page, then a navigation the fixture holds open, both
  # before either run drives anything.
  SETTLED_LOADING="false"
  PENDING_LOADING="true"
  # Any nonzero count. The verdict only checks that the loading state was
  # announced at least once.
  PENDING_LOADING_EVENTS=2
  if [ "$1" = "1" ]; then
    FIRST="/one"
    SECOND="/two"
    THIRD="/slow"
    FOURTH=""
    FIFTH=""
    COUNT=3
    SAW_SLOW_SHOWN=1
    # Nothing drove the guest, so its history did not change.
    BACK_CAN="true/false"
    FORWARD_CAN="true/false"
    FORWARD_EVENTS=0
    # The guest stayed on /two. The control's verdict does not read these,
    # but `set -u` needs them set.
    BACK_PATH="/two"
    FORWARD_PATH="/two"
    # Not read by the control's verdict: the slow page loads on its own.
    STOPPED_LOADING="false"
  else
    FIRST="/one"
    SECOND="/two"
    THIRD="/one"
    FOURTH="/two"
    FIFTH="/two"
    COUNT=5
    SAW_SLOW_SHOWN=0
    # Back used up, forward available; then the reverse. One event each.
    BACK_CAN="false/true"
    FORWARD_CAN="true/false"
    FORWARD_EVENTS=2
    # The element followed the guest both ways without the shell navigating.
    BACK_PATH="/one"
    FORWARD_PATH="/two"
    # stop() canceled the load, which reports as the load finishing.
    STOPPED_LOADING="false"
  fi
}

verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    baseline "$1"
    shift
    for override in "$@"; do
      eval "$override"
    done
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

# The failure message, for cases that check which component it blames. Tests
# match a keyword, not the whole sentence.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    baseline "$1"
    shift
    for override in "$@"; do
      eval "$override"
    done
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(reason "$@")" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "a shell module that never ran is a failure" "fail" \
  "$(verdict 0 SAW_MODULE=0)"
expect "a shell module that never ran is a failure in the control too" "fail" \
  "$(verdict 1 SAW_MODULE=0)"
expect "a shell module that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_MODULE=0)"
expect "an empty window is a failure" "fail" "$(verdict 0 FIRST='""')"
expect "an empty window is a failure in the control too" "fail" \
  "$(verdict 1 FIRST='""')"
expect "an empty window names the guest" "yes" \
  "$(blames "guest" 0 FIRST='""')"
# The second page creates the history; without it, nothing can go back.
expect "one page and no second is a failure" "fail" "$(verdict 0 SECOND='""' COUNT=1)"
expect "one page and no second is a failure in the control too" "fail" \
  "$(verdict 1 SECOND='""' COUNT=1)"
expect "one page and no second says there was no history to move in" "yes" \
  "$(blames "history" 0 SECOND='""' COUNT=1)"

echo
echo "the positive run — the four controls, driven at a guest"
expect "the whole sequence is the pass" "pass" "$(verdict 0)"
# The main claim: the calls must move the guest, not the placeholder frame's
# History.
expect "no third page is a failure" "fail" "$(verdict 0 THIRD='""' COUNT=2)"
expect "no third page names the controller the calls have to reach" "yes" \
  "$(blames "NavigationController" 0 THIRD='""' COUNT=2)"
expect "a third page that is not the first one is a failure" "fail" \
  "$(verdict 0 THIRD=/two)"
expect "no fourth page is a failure" "fail" "$(verdict 0 FOURTH='""' COUNT=3)"
expect "no fourth page names forward" "yes" \
  "$(blames "goForward" 0 FOURTH='""' COUNT=3)"
expect "no fifth page is a failure" "fail" "$(verdict 0 FIFTH='""' COUNT=4)"
expect "no fifth page names reload" "yes" \
  "$(blames "reload" 0 FIFTH='""' COUNT=4)"
# Readings are positional, so an extra navigation (redirect, double send,
# unrequested reload) would shift them and look like a call working.
expect "more pages than were driven is a failure" "fail" "$(verdict 0 COUNT=6)"

echo
echo "where the element says the page is, which is what a padlock sits beside"
# goBack() moves the guest's controller in the browser process; the shell
# navigates nowhere. The element must still report the new page, or a padlock
# drawn beside the address describes the wrong page.
expect "an element that did not follow the guest back is a failure" "fail" \
  "$(verdict 0 BACK_PATH=/two)"
expect "not following back names what nothing in the shell navigated" "yes" \
  "$(blames "nothing in the shell navigated" 0 BACK_PATH=/two)"
expect "an element that did not follow the guest forward is a failure" "fail" \
  "$(verdict 0 FORWARD_PATH=/one)"
# Checked after the sequence: if goBack() never moved the guest, the call is
# blamed, not the report.
expect "a guest that never went back blames the call, not the report" "yes" \
  "$(blames "goBack() did not take the guest back" 0 THIRD=/two BACK_PATH=/two)"
# The address at a point both runs reach shows the report exists at all.
expect "an element showing the wrong page is a failure in both runs" "fail" \
  "$(verdict 1 TWO_PATH=/one)"
expect "an element that reported no page at all is a failure" "fail" \
  "$(verdict 0 TWO_PATH='""')"

echo
echo "and the icon the page names, which is what a launcher learns a site by"
# The page links /two.png. No icon, or the previous page's icon, fails.
expect "an element that named no icon is a failure in both runs" "fail" \
  "$(verdict 1 TWO_FAVICON='""')"
expect "an element naming the last page's icon is a failure" "fail" \
  "$(verdict 0 TWO_FAVICON=/one.png)"
expect "no icon blames the favicon report" "yes" \
  "$(blames "icon the page links" 0 TWO_FAVICON='""')"

echo
echo "and what the browser said about the connection, which it must not invent"
# A chrome draws the padlock from this. Reporting nothing is a broken engine,
# and the chrome would be left to guess from the scheme.
expect "no security for a committed page is a failure" "fail" \
  "$(verdict 0 TWO_SECURITY='""')"
expect "no security names the browser call that computes it" "yes" \
  "$(blames "security_state" 0 TWO_SECURITY='""')"
# An engine without the property: the module logs `undefined`.
expect "an engine with no such property is a failure" "fail" \
  "$(verdict 0 TWO_SECURITY=undefined)"
expect "it is a failure in the control too" "fail" \
  "$(verdict 1 TWO_SECURITY='""')"

echo
echo "stop(), which is measured as an absence and so needs both halves"
# If the slow navigation was never requested, there was no pending load for
# stop() to cancel.
expect "a slow page never asked for is a failure" "fail" \
  "$(verdict 0 SAW_SLOW_ASKED=0)"
expect "a slow page never asked for is a failure in the control too" "fail" \
  "$(verdict 1 SAW_SLOW_ASKED=0 SAW_SLOW_SHOWN=0 THIRD='""' COUNT=2)"
expect "a slow page never asked for blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SLOW_ASKED=0)"
expect "a slow page that arrived anyway is a failure" "fail" \
  "$(verdict 0 SAW_SLOW_SHOWN=1 COUNT=6)"
expect "a slow page that arrived anyway names stop" "yes" \
  "$(blames "stop()" 0 SAW_SLOW_SHOWN=1 COUNT=6)"

echo
echo "the control — the same navigations, with nothing driving the controls"
expect "two pages and then the slow one is the pass" "pass" "$(verdict 1)"
# Inverted: a third page here means something other than goBack() can move
# the guest back.
expect "a third page is the failure" "fail" "$(verdict 1 THIRD=/one COUNT=4)"
expect "a third page says the positive run measured something else" "yes" \
  "$(blames "on its own" 1 THIRD=/one COUNT=4)"
# Also inverted: the positive run's missing slow page means something only if
# the page arrives here, where nothing stopped it.
expect "a slow page that never arrived is the control's failure" "fail" \
  "$(verdict 1 SAW_SLOW_SHOWN=0 THIRD='""' COUNT=2)"
expect "a slow page that never arrived says stop() was not measured" "yes" \
  "$(blames "stop()" 1 SAW_SLOW_SHOWN=0 THIRD='""' COUNT=2)"
expect "more pages than were driven is a failure in the control too" "fail" \
  "$(verdict 1 COUNT=4)"

echo
echo "what the element says back and forward can do, which is the new claim"
# Checked first: an element that always says "no" would pass the absence
# checks, so back must become available once there is a page behind.
expect "back never becoming available is a failure" "fail" \
  "$(verdict 0 TWO_CAN=false/false)"
expect "back never becoming available names the positive it rests on" "yes" \
  "$(blames "never became available" 0 TWO_CAN=false/false)"
expect "a first page with somewhere to go is a failure" "fail" \
  "$(verdict 0 START_CAN=true/true)"
# The value is right but the run fails: this reading must show the state is
# available to an element that has never had a listener.
expect "a two-pages reading taken after an event is a failure" "fail" \
  "$(verdict 0 TWO_EVENTS=1)"
expect "a two-pages reading taken after an event names the listener" "yes" \
  "$(blames "listener" 0 TWO_EVENTS=1)"
expect "back staying available after goBack is a failure" "fail" \
  "$(verdict 0 BACK_CAN=true/false)"
expect "back staying available after goBack names goBack" "yes" \
  "$(blames "goBack()" 0 BACK_CAN=true/false)"
expect "forward not coming back after goForward is a failure" "fail" \
  "$(verdict 0 FORWARD_CAN=false/true)"
expect "no event at all is a failure" "fail" "$(verdict 0 FORWARD_EVENTS=0)"
expect "no event at all names the chrome that would never re-read" "yes" \
  "$(blames "re-read" 0 FORWARD_EVENTS=0)"

echo
echo "whether a page is still arriving, which is the other new claim"
# Fails an element that always answers `false`: with a navigation held open,
# it must report loading.
expect "never saying a page is on its way is a failure" "fail" \
  "$(verdict 0 PENDING_LOADING=false)"
expect "never saying a page is on its way names the positive it rests on" \
  "yes" "$(blames "THIS IS THE POSITIVE" 0 PENDING_LOADING=false)"
# Fails an element that always answers `true`: a finished page is not
# loading.
expect "a settled page still called loading is a failure" "fail" \
  "$(verdict 0 SETTLED_LOADING=true)"
expect "a settled page still called loading names the load finishing" "yes" \
  "$(blames "answering yes to everything" 0 SETTLED_LOADING=true)"
# A chrome re-renders on the event, so without it the address bar stays at
# its first render even if the property is right.
expect "no loading event at all is a failure" "fail" \
  "$(verdict 0 PENDING_LOADING_EVENTS=0)"
expect "no loading event at all names the chrome that would never re-read" \
  "yes" "$(blames "re-read" 0 PENDING_LOADING_EVENTS=0)"
# A spinner still turning after stop() means the cancel did not reach the
# element.
expect "a canceled load still called loading is a failure" "fail" \
  "$(verdict 0 STOPPED_LOADING=true)"
expect "a canceled load still called loading names the spinner" "yes" \
  "$(blames "spinner" 0 STOPPED_LOADING=true)"

echo
echo "and the control, where the same readings invert"
expect "back never becoming available is a failure in the control too" "fail" \
  "$(verdict 1 TWO_CAN=false/false)"
# Inverted: with nothing driving it, back going dead means the positive run's
# reading may not come from goBack().
expect "back going dead with nothing driving it is the failure" "fail" \
  "$(verdict 1 BACK_CAN=false/true)"
expect "back going dead on its own says the positive measured something else" \
  "yes" "$(blames "on its own" 1 BACK_CAN=false/true)"
expect "an event with nothing driving it is a failure" "fail" \
  "$(verdict 1 FORWARD_EVENTS=1)"
expect "an event with nothing driving it says the positive count is noise" \
  "yes" "$(blames "noise" 1 FORWARD_EVENTS=1)"
# Not inverted: the positive run cancels this load a step later, so the
# control shows it was still in flight when read.
expect "a slow navigation already landed is the control's failure" "fail" \
  "$(verdict 1 PENDING_LOADING=false)"
expect "a slow navigation already landed says the positive read a leftover" \
  "yes" "$(blames "not about a load in flight" 1 PENDING_LOADING=false)"
expect "a settled page still called loading is a failure in the control too" \
  "fail" "$(verdict 1 SETTLED_LOADING=true)"

echo
echo "when the guard stops waiting on the slow page"
# "The slow page never arrived" only counts once it can no longer arrive: the
# fixture saw the browser hang up, or the page came.
SETTLED="$(awk '/^slow_settled\(\) \{$/,/^}$/' "$GUARD")"
[ -n "$SETTLED" ] || {
  echo "no slow_settled in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
settled() { # $1 http log, $2 engine log
  (
    HTTP_LOG="$LOGS/http" ENGINE_LOG="$LOGS/engine"
    printf '%s\n' "$1" >"$HTTP_LOG"
    printf '%s\n' "$2" >"$ENGINE_LOG"
    eval "$SETTLED"
    slow_settled && echo yes || echo no
  )
}
expect "a slow page only asked for is still to come" "no" \
  "$(settled "asked /slow" "GUARD done")"
expect "a slow page the browser hung up on can no longer come" "yes" \
  "$(settled "$(printf 'asked /slow\nabandoned /slow')" "GUARD done")"
expect "a slow page that arrived has come" "yes" \
  "$(settled "asked /slow" "GUARD guest-shown path=/slow serial=4")"

echo
echo "when the guard reads the icon the element named"
FAVICON_AT="$(awk '/^favicon_at\(\) \{/,/^}$/' "$GUARD")"
[ -n "$FAVICON_AT" ] || {
  echo "no favicon_at in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}
favicon_read() { # $1 engine log
  (
    ENGINE_LOG="$LOGS/engine"
    printf '%s\n' "$1" >"$ENGINE_LOG"
    eval "$FAVICON_AT"
    favicon_at two-pages
  )
}
# Engine log format: the quoted console line, then its source.
expect "the path is read up to the console line's closing quote" "/two.png" \
  "$(favicon_read '[1:1:0/0:INFO:CONSOLE:118] "GUARD favicon-state at=two-pages path=/two.png", source: domicile://shell/guard-webview-history.js (118)')"
expect "an icon the element never named is read as empty" "" \
  "$(favicon_read '[1:1:0/0:INFO:CONSOLE:118] "GUARD favicon-state at=two-pages path=", source: x (1)')"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the history guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
