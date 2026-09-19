#!/usr/bin/env bash
# Which end the new-window guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-new-window.sh` — the `if`
# chain that turns ten readings and the run's mode into either a pass or one
# sentence naming an end. The readings are not independent: a run where the
# shell page never ran has established nothing, a run where no press reached
# that document is not a run about a link, and "the link asked for no window"
# is only a finding once a press has landed on a link. So the chain is ordered,
# and an ordered chain is a thing that can be got wrong in a way no failing
# engine would ever reveal — the wrong arm answers, with a true-sounding
# sentence about the wrong layer, and the next person spends a CI cycle on it.
#
# It matters most for the readings a verdict written by symmetry gets backward:
#
#   in the control run, the element ASKING for a window is the failure, and so
#     is a press that followed no link at all — its absence of a window means
#     nothing if nothing was clicked
#   a press that landed on the ordinary link in the POSITIVE run is geometry
#     rather than the defect: what that run measures was never clicked
#   an ask with no page at the far end is a failure, not a pass — an event is
#     not a window, and a desktop that dispatches one and shows nothing is
#     exactly what this guard exists to fail
#   which process to blame when nothing was asked for depends on a line the
#     browser writes, not on anything the page can see
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-new-window.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi` in the
# control's arm is indented, and the block stops before the `if [ -n "$PASSED" ]`
# below it — a verdict is a value here, not a status.
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
# reading. Written as a baseline plus overrides rather than ten positional
# arguments, because a case that says `SAW_ASKED=0` says what it is testing and
# a case that says `1 1 1 1 0 1` does not.
#
# `SAW_STAYED=0` in the baseline, because the claim's run clicks the other link:
# the page staying put is the CONTROL's positive reading, and a claim run that
# had it clicked the wrong half.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_ASKED=1
    SAW_ADDRESS=1
    SAW_SECOND=1
    SAW_OPENED=1
    SAW_STAYED=0
    SAW_REFUSED=1
    NEGATIVE="$1"
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
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_ASKED=1
    SAW_ADDRESS=1
    SAW_SECOND=1
    SAW_OPENED=1
    SAW_STAYED=0
    SAW_REFUSED=1
    NEGATIVE="$1"
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

# The control's own shape: it clicks the ordinary link, so it asks for no
# window, opens nothing, and the page it clicked in navigates.
control() { # the overrides a case adds
  verdict 1 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 SAW_STAYED=1 \
    SAW_REFUSED=0 "$@"
}

controlBlames() { # $1 word, then overrides
  blames "$1" 1 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0 "${@:2}"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_SHELL=0)"
# AND IN THE CONTROL RUN, which is the arm a verdict written as "the control
# passes when nothing is asked for" gets wrong: with no page at all, nothing
# being asked for is what a broken harness looks like too.
expect "a shell that never ran is a failure in the control run" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no press in the shell's document is a failure in the control too" \
  "fail" "$(control SAW_CHROME=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
# AN EMPTY WINDOW IS BOTH RUNS' PROBLEM HERE, unlike the click guard's control,
# which never clicks into the window at all: both of these clicks land on a
# link in the page, so neither run means anything without one.
expect "an empty window is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_PAGE=0)"
expect "an empty window is a failure in the control run" "fail" \
  "$(control SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press that never reached the guest is a failure" "fail" \
  "$(verdict 0 SAW_GUEST=0)"
expect "a press that never reached the guest blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0)"

echo
echo "the positive run — a target=_blank link, and the window it must produce"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# THE ONE THAT READS LIKE THE DEFECT AND IS NOT: the press landed on the
# control's link, so the run measured the wrong half of the page.
expect "a press on the ordinary link is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0)"
expect "a press on the ordinary link blames the geometry" "yes" \
  "$(blames "geometry" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0)"
# WHICH PROCESS TO LOOK IN, and the only reading that can say. The browser's
# own line means the renderer DID ask and the refusal never came back to the
# page; its absence means nothing ever asked, and no patch in the page's layer
# can be the fix.
expect "an ask the browser refused and never reported is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0)"
expect "an ask the browser refused and never reported blames the report" \
  "yes" "$(blames "THE PAGE WAS NOT TOLD" 0 SAW_ASKED=0 SAW_ADDRESS=0 \
    SAW_SECOND=0 SAW_OPENED=0)"
expect "no ask at the browser at all blames the renderer's request" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 \
    SAW_OPENED=0 SAW_REFUSED=0)"
expect "no ask at the browser at all does not blame the report" "no" \
  "$(blames "THE PAGE WAS NOT TOLD" 0 SAW_ASKED=0 SAW_ADDRESS=0 \
    SAW_SECOND=0 SAW_OPENED=0 SAW_REFUSED=0)"
# AND THE ORDER, which is why the wrong-link arm is asked first: a run that
# clicked the ordinary link has both of the readings above missing too, and
# naming the crossing there would send the next person into two processes over
# a press that landed two hundred pixels off.
expect "the wrong link outranks the process the ask stopped in" "no" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 \
    SAW_OPENED=0 SAW_STAYED=1 SAW_REFUSED=0)"

echo
echo "the address, and the window the event is only half of"
expect "an event carrying the wrong address is a failure" "fail" \
  "$(verdict 0 SAW_ADDRESS=0)"
expect "an event carrying the wrong address says so" "yes" \
  "$(blames "WRONG ADDRESS" 0 SAW_ADDRESS=0)"
expect "a shell that was told and opened nothing is a failure" "fail" \
  "$(verdict 0 SAW_SECOND=0 SAW_OPENED=0)"
expect "a shell that was told and opened nothing blames this guard's page" \
  "yes" "$(blames "guard-webview-new-window.js" 0 SAW_SECOND=0 SAW_OPENED=0)"
# THE ARM THIS WHOLE GUARD EXISTS FOR. Everything an event-only guard would
# assert is true here and the user is looking at an empty window.
expect "a second view with no page in it is a failure" "fail" \
  "$(verdict 0 SAW_OPENED=0)"
expect "a second view with no page in it names the second guest" "yes" \
  "$(blames "AN EVENT AND NO WINDOW" 0 SAW_OPENED=0)"

echo
echo "the control run — an ordinary link, which must ask for nothing"
expect "asking for nothing and navigating is the pass" "pass" "$(control)"
expect "an ask is the failure" "fail" "$(control SAW_ASKED=1)"
expect "an ask says the positive run would be measuring the element" "yes" \
  "$(controlBlames "any click" SAW_ASKED=1)"
# AND THE READING THAT MAKES THE ABSENCE A MEASUREMENT: a press that followed
# no link tells nobody anything about links.
expect "a press that followed no link is the control's failure" "fail" \
  "$(control SAW_STAYED=0)"
expect "a press that followed no link blames the geometry" "yes" \
  "$(controlBlames "geometry" SAW_STAYED=0)"
# The control is a control whatever the claim's own readings say: it is not
# about the second window, so a run with none of that is still its pass.
expect "the second window is not the control's business" "pass" \
  "$(control SAW_SECOND=0 SAW_OPENED=0 SAW_ADDRESS=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the new-window guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
