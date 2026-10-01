#!/usr/bin/env bash
# Which end the find guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-find.sh` — the `if` chain
# that turns the element's readings, plus the run's mode, into either a pass or
# one sentence naming an end. The readings are ordered because they depend on
# each other: a find that never counted has nothing for a navigation to end, so
# "a new page did not end the find" would be a true sentence about the wrong
# layer.
#
# It matters most for the readings a verdict written by symmetry gets
# backward:
#
#   in the control, any count is the FAILURE — nothing called a find there, so
#     a count means the positive run's need not have been the find's
#   in the control, an event is a failure, for the same reason
#   a count of two is a failure that names the FRAME, not the find: the find
#     reached the guest, and what it missed is the cross-site third
#   a frame the server was never asked for is a failure in both runs, because
#     a count of two would then be right
#   a second page that never arrived is a failure in both, because a 0/0
#     there is then read on a page that never changed
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-find.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, and every nested `fi` in the chain is indented.
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

# A run in which everything the guard wants is true; each case below changes
# one reading. The two modes differ in the readings only: the control calls no
# find, so every one of them is 0/0 with no event.
baseline() { # $1 NEGATIVE
  NEGATIVE="$1"
  MATCHES=3
  SAW_MODULE=1
  SAW_WORDS=1
  SAW_FRAMED_ASKED=1
  SAW_ELSEWHERE=1
  NAVIGATED="0/0"
  NAVIGATED_EVENTS=0
  STOPPED="0/0"
  if [ "$1" = "1" ]; then
    FOUND="0/0"
    FOUND_EVENTS=0
    NEXT="0/0"
    PREVIOUS="0/0"
    REFOUND="0/0"
  else
    FOUND="3/1"
    # Any count but zero: how many is the browser's business, as the count
    # settles frame by frame.
    FOUND_EVENTS=2
    NEXT="3/2"
    PREVIOUS="3/1"
    REFOUND="3/1"
    NAVIGATED_EVENTS=6
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

# The failing sentence, for the cases where WHICH end it names is the point.
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
expect "no page to search is a failure" "fail" "$(verdict 0 SAW_WORDS=0)"
expect "no page to search names the guest" "yes" \
  "$(blames "guest" 0 SAW_WORDS=0)"
# Without the frame a count of two is the right answer, so "the count missed
# the frame" would be a sentence about a frame that was never there.
expect "a frame never asked for is a failure" "fail" \
  "$(verdict 0 SAW_FRAMED_ASKED=0 FOUND=2/1)"
expect "a frame never asked for blames the fixture, not the find" "yes" \
  "$(blames "not the find" 0 SAW_FRAMED_ASKED=0 FOUND=2/1)"
expect "a frame never asked for is a failure in the control too" "fail" \
  "$(verdict 1 SAW_FRAMED_ASKED=0)"

echo
echo "the positive run — a find, driven at a guest"
expect "every reading as it should be is the pass" "pass" "$(verdict 0)"
# THE CLAIM. What an element whose find goes nowhere reads.
expect "nothing found is a failure" "fail" "$(verdict 0 FOUND=0/0)"
expect "nothing found names the pipe and the answer" "yes" \
  "$(blames "FindChanged" 0 FOUND=0/0)"
expect "no reading at all is a failure" "fail" "$(verdict 0 FOUND='""')"
# The cross-site frame is out of process; a count that stops at the main frame
# is the one part of this a renderer could have faked.
expect "a count of two is a failure" "fail" "$(verdict 0 FOUND=2/1)"
expect "a count of two names the cross-site frame" "yes" \
  "$(blames "cross-site frame" 0 FOUND=2/1)"
expect "a count with nothing selected is a failure" "fail" \
  "$(verdict 0 FOUND=3/0)"
expect "a count with no event behind it is a failure" "fail" \
  "$(verdict 0 FOUND_EVENTS=0)"
expect "a count with no event names the find bar that would never re-read" \
  "yes" "$(blames "re-read" 0 FOUND_EVENTS=0)"
expect "the same text again staying on the first is a failure" "fail" \
  "$(verdict 0 NEXT=3/1)"
expect "staying on the first names find next" "yes" \
  "$(blames "find next" 0 NEXT=3/1)"
expect "backward going forward is a failure" "fail" \
  "$(verdict 0 PREVIOUS=3/3)"
expect "backward going forward names the patch" "yes" \
  "$(blames "patch 0067" 0 PREVIOUS=3/3)"
expect "a count left after stopFinding is a failure" "fail" \
  "$(verdict 0 STOPPED=3/1)"
expect "a count left after stopFinding names it" "yes" \
  "$(blames "stopFinding()" 0 STOPPED=3/1)"
# Which match a search from a kept selection lands on is Blink's business.
expect "a find after stopping may land on any match" "pass" \
  "$(verdict 0 REFOUND=3/2)"
expect "a find after stopping that selects nothing is a failure" "fail" \
  "$(verdict 0 REFOUND=3/0)"
expect "a find after stopping that counts nothing is a failure" "fail" \
  "$(verdict 0 REFOUND=0/0)"

echo
echo "a new page ends a find, which needs the page to have been new"
expect "a count still held on a new page is a failure" "fail" \
  "$(verdict 0 NAVIGATED=3/1)"
expect "a count still held on a new page names the rule" "yes" \
  "$(blames "A NEW PAGE ENDS A FIND" 0 NAVIGATED=3/1)"
# ORDERED UNDER THE NAVIGATION IT DEPENDS ON. A 0/0 on a page that never came
# is a reading of nothing, and the stale count is then not the rule's fault.
expect "a second page that never arrived is a failure" "fail" \
  "$(verdict 0 SAW_ELSEWHERE=0)"
expect "a second page that never arrived blames the navigation first" "yes" \
  "$(blames "navigation, not the find" 0 SAW_ELSEWHERE=0 NAVIGATED=3/1)"

echo
echo "the control — the same pages, with no find called"
expect "0/0 throughout with no event is the pass" "pass" "$(verdict 1)"
# THE INVERTED ONE. A count here is one nobody asked for.
expect "a count with nothing calling a find is the failure" "fail" \
  "$(verdict 1 FOUND=3/1)"
expect "a count unasked says this pair decides nothing" "yes" \
  "$(blames "decides nothing" 1 FOUND=3/1)"
expect "a count read only after the navigation is the failure too" "fail" \
  "$(verdict 1 NAVIGATED=3/1)"
expect "an event with nothing driving it is a failure" "fail" \
  "$(verdict 1 NAVIGATED_EVENTS=1)"
expect "an event with nothing driving it says the positive's are noise" "yes" \
  "$(blames "noise" 1 NAVIGATED_EVENTS=1)"
expect "a second page that never arrived is a failure in the control too" \
  "fail" "$(verdict 1 SAW_ELSEWHERE=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the find guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
