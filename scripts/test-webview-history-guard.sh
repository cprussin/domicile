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
# backwards:
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
# pinned them would fail for edits that changed no behaviour.
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
echo "stop(), which is measured as an absence and so needs both halves"
# An absence nobody caused. If the last navigation never left the element,
# there is no pending load for stop() to have cancelled and the slow page's
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

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the history guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
