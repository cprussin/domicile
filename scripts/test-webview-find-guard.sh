#!/usr/bin/env bash
# Tests the verdict of `guard-webview-find.sh`: which readings pass and which
# component a failure blames.
#
# The checks are ordered because the readings depend on each other: if the
# find never counted, a navigation has nothing to end. Easy to get backward:
#
#   - In the control, any count or event is the failure: nothing called find.
#   - A count of two blames the cross-site frame, not the find.
#   - A frame the server never served fails both runs, since two would then be
#     the right count.
#   - A second page that never arrived fails both runs, since 0/0 would then
#     be read on the old page.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-find.sh"
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

# Sets every reading to its passing value; each case overrides one. The
# control calls no find, so its counts are 0/0 with no events.
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
    # Any nonzero number: the count settles frame by frame.
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

# The failure message, for cases that check which component it blames.
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
# Without the frame, two is the right count, so blaming the find would be
# wrong.
expect "a frame never asked for is a failure" "fail" \
  "$(verdict 0 SAW_FRAMED_ASKED=0 FOUND=2/1)"
expect "a frame never asked for blames the fixture, not the find" "yes" \
  "$(blames "not the find" 0 SAW_FRAMED_ASKED=0 FOUND=2/1)"
expect "a frame never asked for is a failure in the control too" "fail" \
  "$(verdict 1 SAW_FRAMED_ASKED=0)"

echo
echo "the positive run — a find, driven at a guest"
expect "every reading as it should be is the pass" "pass" "$(verdict 0)"
# The claim: what an element whose find goes nowhere reads.
expect "nothing found is a failure" "fail" "$(verdict 0 FOUND=0/0)"
expect "nothing found names the pipe and the answer" "yes" \
  "$(blames "FindChanged" 0 FOUND=0/0)"
expect "no reading at all is a failure" "fail" "$(verdict 0 FOUND='""')"
# The cross-site frame is out of process. A renderer alone could produce a
# count that stops at the main frame.
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
  "$(blames "patch 0073" 0 PREVIOUS=3/3)"
expect "a count left after stopFinding is a failure" "fail" \
  "$(verdict 0 STOPPED=3/1)"
expect "a count left after stopFinding names it" "yes" \
  "$(blames "stopFinding()" 0 STOPPED=3/1)"
# Blink decides which match a search from a kept selection lands on.
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
# Checked after the navigation: a 0/0 on a page that never loaded proves
# nothing.
expect "a second page that never arrived is a failure" "fail" \
  "$(verdict 0 SAW_ELSEWHERE=0)"
expect "a second page that never arrived blames the navigation first" "yes" \
  "$(blames "navigation, not the find" 0 SAW_ELSEWHERE=0 NAVIGATED=3/1)"

echo
echo "the control — the same pages, with no find called"
expect "0/0 throughout with no event is the pass" "pass" "$(verdict 1)"
# Inverted: any count here is unrequested.
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
