#!/usr/bin/env bash
# Which end the history guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-history.sh` — the `if` chain
# that turns the sequence of pages a guest showed, plus the run's mode, into
# either a pass or one sentence naming an end. The readings are ordered because
# they depend on each other: a run in which no second page ever loaded has no
# history to go back in, so "the page did not go back" would be a true sentence
# about the wrong layer, and the next person spends a CI cycle on it.
#
# It matters most for the readings a verdict written by symmetry gets
# backward:
#
#   in the control, the third page appearing is the FAILURE — nothing drove a
#     control there, so a page that moved anyway means the positive run's third
#     line could have come from something other than goBack()
#   in the control, the slow page NOT arriving is a failure, even though its
#     absence is exactly what the positive run wants: it is what makes that
#     absence a measurement of stop() rather than of a fixture that never
#     answers
#   a slow page the server was never asked for is a failure in both, because
#     an absence nobody caused is not an absence anybody measured
#   in the control, `back` STAYING available is the pass and its going dead is
#     the failure, which is the availability half of the same inversion: a
#     guest whose history goes dead with nothing driving it means the positive
#     run's dead back need not have been goBack()'s
#   in the control, an event is a failure, because the positive run reads its
#     two events as the two calls and a run that pushes without being driven
#     makes that reading noise
#   a `can` read at two-pages by an element that HAD heard an event is a
#     failure even though the value is right: that reading is the one that says
#     a late-mounting chrome sees the state, and it says it only while the
#     element has never had a listener
#   in the control, the slow navigation must still be PENDING where it is
#     read, even though the positive run wants it canceled a step later: it is
#     what makes the positive run's pending reading a load in flight rather
#     than a leftover from a page that had already landed
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-history.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: every nested `fi` in the
# chain is indented, and the block stops before the `if [ -n "$PASSED" ]` below
# it — a verdict is a value here, not a status.
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

# A run in which everything the guard wants is true; each case below changes one
# reading. Written as a baseline plus overrides rather than eight positional
# arguments, because a case that says `THIRD=""` says what it is testing and a
# case that says `1 /one /two "" /two /two 4 1 0` does not.
#
# The two modes have different baselines, and that is the shape of the
# experiment rather than an accident of the test: the positive run drives five
# navigations and the control drives two and then the slow one, so "everything
# as it should be" is a different sequence in each.
baseline() { # $1 NEGATIVE
  SAW_MODULE=1
  SAW_SLOW_ASKED=1
  # Not a reading: the fixture's wait, which one failing sentence quotes back.
  SLOW_SECONDS=20
  NEGATIVE="$1"
  # The first page of a history has nowhere to go in either direction, and no
  # listener has been on the element yet. Shared, because nothing has been
  # driven at this point in either run.
  START_CAN="false/false"
  TWO_CAN="true/false"
  TWO_EVENTS=0
  # Where the element said it was and what the browser said about getting
  # there. Shared, because `two-pages` is read before either run drives
  # anything — the guest is on its second page in both.
  TWO_PATH="/two"
  TWO_SECURITY="neutral"
  # Shared too, and for the same reason: the guest is on a page that arrived a
  # whole step ago, and then on a navigation the fixture is still holding open.
  # Neither run has driven anything by either point.
  SETTLED_LOADING="false"
  PENDING_LOADING="true"
  # Any count but zero. The verdict asks only whether the element ever said its
  # loading state changed — how many times is the schedule's business, and a
  # number pinned here would be a second copy of it.
  PENDING_LOADING_EVENTS=2
  if [ "$1" = "1" ]; then
    FIRST="/one"
    SECOND="/two"
    THIRD="/slow"
    FOURTH=""
    FIFTH=""
    COUNT=3
    SAW_SLOW_SHOWN=1
    # Nothing drove the guest, so its history neither moved nor pushed.
    BACK_CAN="true/false"
    FORWARD_CAN="true/false"
    FORWARD_EVENTS=0
    # And it never left /two, so that is where the element still says it is.
    # Not read in the control's verdict; set because the block is one chain and
    # `set -u` does not care which arm would have used it.
    BACK_PATH="/two"
    FORWARD_PATH="/two"
    # Not read in the control's verdict — nothing stopped the load, so the
    # slow page lands on its own and this says only that it did.
    STOPPED_LOADING="false"
  else
    FIRST="/one"
    SECOND="/two"
    THIRD="/one"
    FOURTH="/two"
    FIFTH="/two"
    COUNT=5
    SAW_SLOW_SHOWN=0
    # Back spent, forward earned; then forward spent and back earned again.
    # One push each, which is the two events.
    BACK_CAN="false/true"
    FORWARD_CAN="true/false"
    FORWARD_EVENTS=2
    # And the element followed the guest both ways, which is the reading the
    # whole page report exists for: nothing in the shell navigated to either.
    BACK_PATH="/one"
    FORWARD_PATH="/two"
    # stop() canceled the load, which the browser reports like any other one
    # finishing.
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

# The failing sentence, for the cases where WHICH end it names is the point. Not
# the whole wording: sentences are prose and will be reworded, and a test that
# pinned them would fail for edits that changed no behavior.
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
# The second page is what makes a history. Without it "the page did not go
# back" is a sentence about a page that had nowhere to go.
expect "one page and no second is a failure" "fail" "$(verdict 0 SECOND='""' COUNT=1)"
expect "one page and no second is a failure in the control too" "fail" \
  "$(verdict 1 SECOND='""' COUNT=1)"
expect "one page and no second says there was no history to move in" "yes" \
  "$(blames "history" 0 SECOND='""' COUNT=1)"

echo
echo "the positive run — the four controls, driven at a guest"
expect "the whole sequence is the pass" "pass" "$(verdict 0)"
# THE CLAIM. This is the arm that was failing before the wiring existed: the
# calls reached the placeholder frame's History and the guest never moved.
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
# A page that moved more times than the guard drove it: a redirect, a double
# send, a reload nobody asked for. Every reading above is positional, so an
# extra navigation anywhere in the middle would shift them and be read as one
# of the calls working.
expect "more pages than were driven is a failure" "fail" "$(verdict 0 COUNT=6)"

echo
echo "where the element says the page is, which is what a padlock sits beside"
# THE CLAIM THE PAGE REPORT EXISTS FOR. The guest went back because goBack()
# moved its own controller in the browser process; nothing in the shell
# navigated anywhere. An element that still names the page the user left is a
# chrome that cannot follow its own window — and a lock drawn next to that
# address describes a page nobody is on.
expect "an element that did not follow the guest back is a failure" "fail" \
  "$(verdict 0 BACK_PATH=/two)"
expect "not following back names what nothing in the shell navigated" "yes" \
  "$(blames "nothing in the shell navigated" 0 BACK_PATH=/two)"
expect "an element that did not follow the guest forward is a failure" "fail" \
  "$(verdict 0 FORWARD_PATH=/one)"
# ORDERED UNDER THE SEQUENCE IT DEPENDS ON. A run where goBack() never moved
# the guest has no page for the element to have failed to follow, so the
# sequence has to be blamed first or the next person debugs the wrong layer.
expect "a guest that never went back blames the call, not the report" "yes" \
  "$(blames "goBack() did not take the guest back" 0 THIRD=/two BACK_PATH=/two)"
# And the address at a point BOTH runs reach, which is the reading that says
# the report exists at all rather than that it follows a particular call.
expect "an element showing the wrong page is a failure in both runs" "fail" \
  "$(verdict 1 TWO_PATH=/one)"
expect "an element that reported no page at all is a failure" "fail" \
  "$(verdict 0 TWO_PATH='""')"

echo
echo "and what the browser said about the connection, which it must not invent"
# A PADLOCK IS DRAWN FROM THIS. An engine that reports nothing leaves a chrome
# with nothing to draw — which is the honest outcome — but it is still a broken
# engine, and the alternative a chrome reaches for is guessing from the scheme.
expect "no security for a committed page is a failure" "fail" \
  "$(verdict 0 TWO_SECURITY='""')"
expect "no security names the browser call that computes it" "yes" \
  "$(blames "security_state" 0 TWO_SECURITY='""')"
# What an engine older than the property looks like from the page: the element
# has no such attribute, so the module logs the word `undefined`.
expect "an engine with no such property is a failure" "fail" \
  "$(verdict 0 TWO_SECURITY=undefined)"
expect "it is a failure in the control too" "fail" \
  "$(verdict 1 TWO_SECURITY='""')"

echo
echo "stop(), which is measured as an absence and so needs both halves"
# An absence nobody caused. If the last navigation never left the element,
# there is no pending load for stop() to have canceled and the slow page's
# absence is about the harness.
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
# THE INVERTED ONE. A third page here means something other than goBack() can
# move a guest back to a page it has shown, which is the confound the positive
# run cannot see from the inside.
expect "a third page is the failure" "fail" "$(verdict 1 THIRD=/one COUNT=4)"
expect "a third page says the positive run measured something else" "yes" \
  "$(blames "on its own" 1 THIRD=/one COUNT=4)"
# THE OTHER INVERTED ONE. The positive run reads stop() as the slow page never
# appearing; that reading is worth nothing unless the same page appears here,
# where nothing stopped it.
expect "a slow page that never arrived is the control's failure" "fail" \
  "$(verdict 1 SAW_SLOW_SHOWN=0 THIRD='""' COUNT=2)"
expect "a slow page that never arrived says stop() was not measured" "yes" \
  "$(blames "stop()" 1 SAW_SLOW_SHOWN=0 THIRD='""' COUNT=2)"
expect "more pages than were driven is a failure in the control too" "fail" \
  "$(verdict 1 COUNT=4)"

echo
echo "what the element says back and forward can do, which is the new claim"
# THE POSITIVE, AND IT IS FIRST ON PURPOSE. A guard that read only "back is
# unavailable on the first page" would pass against an element that always said
# no, so the reading that has to hold before any absence means anything is that
# back becomes available once there IS a page behind.
expect "back never becoming available is a failure" "fail" \
  "$(verdict 0 TWO_CAN=false/false)"
expect "back never becoming available names the positive it rests on" "yes" \
  "$(blames "never became available" 0 TWO_CAN=false/false)"
expect "a first page with somewhere to go is a failure" "fail" \
  "$(verdict 0 START_CAN=true/true)"
# THE LATE-MOUNT READING. The value is right in this case and the run still
# fails, because what that reading establishes is that an element which has
# never had a listener reports the state anyway — and an element that had
# heard an event establishes nothing of the sort.
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
# THE POSITIVE HERE TOO, and it is what an element answering `false` to
# everything fails: with the fixture holding a navigation open, the element has
# to say a page is on its way.
expect "never saying a page is on its way is a failure" "fail" \
  "$(verdict 0 PENDING_LOADING=false)"
expect "never saying a page is on its way names the positive it rests on" \
  "yes" "$(blames "THIS IS THE POSITIVE" 0 PENDING_LOADING=false)"
# And the other end, which an element answering `true` to everything fails: a
# page that arrived a step ago is not arriving.
expect "a settled page still called loading is a failure" "fail" \
  "$(verdict 0 SETTLED_LOADING=true)"
expect "a settled page still called loading names the load finishing" "yes" \
  "$(blames "answering yes to everything" 0 SETTLED_LOADING=true)"
# The value can be right and the run still fail: a chrome renders from the
# property and re-renders on the event, and an element with no event is an
# address bar frozen at whatever its first render caught.
expect "no loading event at all is a failure" "fail" \
  "$(verdict 0 PENDING_LOADING_EVENTS=0)"
expect "no loading event at all names the chrome that would never re-read" \
  "yes" "$(blames "re-read" 0 PENDING_LOADING_EVENTS=0)"
# stop() is read as the slow page never appearing; a spinner still turning
# after it is the same cancellation not reaching the element.
expect "a canceled load still called loading is a failure" "fail" \
  "$(verdict 0 STOPPED_LOADING=true)"
expect "a canceled load still called loading names the spinner" "yes" \
  "$(blames "spinner" 0 STOPPED_LOADING=true)"

echo
echo "and the control, where the same readings invert"
expect "back never becoming available is a failure in the control too" "fail" \
  "$(verdict 1 TWO_CAN=false/false)"
# THE INVERTED ONE. With nothing driving it, a guest that stops being able to
# go back has done so on its own — and the positive run's dead back is then
# not a reading of goBack().
expect "back going dead with nothing driving it is the failure" "fail" \
  "$(verdict 1 BACK_CAN=false/true)"
expect "back going dead on its own says the positive measured something else" \
  "yes" "$(blames "on its own" 1 BACK_CAN=false/true)"
expect "an event with nothing driving it is a failure" "fail" \
  "$(verdict 1 FORWARD_EVENTS=1)"
expect "an event with nothing driving it says the positive count is noise" \
  "yes" "$(blames "noise" 1 FORWARD_EVENTS=1)"
# NOT INVERTED, and that is the point of reading it here: the positive run
# cancels this load a step later, so the control is where "it was still in
# flight when we looked" is established with nothing having touched it.
expect "a slow navigation already landed is the control's failure" "fail" \
  "$(verdict 1 PENDING_LOADING=false)"
expect "a slow navigation already landed says the positive read a leftover" \
  "yes" "$(blames "not about a load in flight" 1 PENDING_LOADING=false)"
expect "a settled page still called loading is a failure in the control too" \
  "fail" "$(verdict 1 SETTLED_LOADING=true)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the history guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
