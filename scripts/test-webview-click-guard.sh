#!/usr/bin/env bash
# Which end the click guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-click.sh` — the `if` chain
# that turns fourteen readings and the run's mode into either a pass or one
# sentence naming an end. The readings are not independent: a run where the shell page
# never ran has established nothing, a run where no press reached that document
# is not a run about what crosses into it, and "the press did not cross out of
# the guest" is only a finding once something has landed in the guest. So the
# chain is ordered, and an ordered chain is a thing that can be got wrong in a
# way no failing engine would ever reveal — the wrong arm answers, with a
# true-sounding sentence about the wrong layer, and the next person spends a CI
# cycle on it.
#
# It matters most for the three readings a verdict written by symmetry gets
# backwards:
#
#   in the control run, the element being REACHED is the failure, and so is a
#     press that landed in the guest it was aimed away from
#   a press that never reached the guest is the harness rather than the defect
#     — the claim is about what crosses out of a guest, and nothing went in
#   the element not being activeElement is a PASS, one reading short: the shell
#     raises a window on the focus event and reads activeElement never, so that
#     absence is worth reporting and is not the claim
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-click.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi` in the
# negative arm is indented, and the block stops before the `if [ -n "$PASSED" ]`
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
# reading. Written as a baseline plus overrides rather than nine positional
# arguments, because a case that says `SAW_REACHED=0` says what it is testing
# and a case that says `1 1 1 1 0 1` does not.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_REACHED=1
    SAW_ACTIVE=1
    SAW_BLUR=1
    SAW_GUEST_FOCUS=1
    SAW_AT_ELEMENT=1
    SAW_ANNOUNCING=1
    SAW_ANNOUNCED=1
    SAW_BRANCH=1
    SAW_FOCUSED_IT=1
    SAW_SET_FOCUSED=1
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
# pinned them would fail for edits that changed no behaviour.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_REACHED=1
    SAW_ACTIVE=1
    SAW_BLUR=1
    SAW_GUEST_FOCUS=1
    SAW_AT_ELEMENT=1
    SAW_ANNOUNCING=1
    SAW_ANNOUNCED=1
    SAW_BRANCH=1
    SAW_FOCUSED_IT=1
    SAW_SET_FOCUSED=1
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

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_SHELL=0)"
# AND IN THE CONTROL RUN, which is the arm a verdict written as "the control
# passes when nothing is reached" gets wrong: with no page at all, nothing
# being reached is what a broken harness looks like too.
expect "a shell that never ran is a failure in the control run" "fail" \
  "$(verdict 1 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no press in the shell's document is a failure in the control too" \
  "fail" "$(verdict 1 SAW_CHROME=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"

echo
echo "the positive run — a press in the guest, which the shell must be told of"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# An empty window is a guest that was never made, which is the guest layer's
# business rather than the crossing's — and it is asked ONLY of the positive
# run, because the control never clicks into the window at all.
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
# THE ONE THAT READS LIKE THE DEFECT AND IS NOT. Nothing landed in the guest,
# so nothing was asked to cross out of it.
expect "a press that never reached the guest is a failure" "fail" \
  "$(verdict 0 SAW_GUEST=0)"
expect "a press that never reached the guest blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0)"
expect "a press that never reached the guest is not read as the defect" "no" \
  "$(blames "THE DEFECT" 0 SAW_GUEST=0)"
# SAW_AT_ELEMENT=0 with it, because "the element said nothing" is the case
# this arm is about: an event that fired and did not travel is the arm below.
# With the step readings present this is the sharper arm rather than the
# generic one: the guard knows the focus took and the override did not run.
expect "a press that landed and did not cross is the defect" "yes" \
  "$(blames "OVERRIDE DID NOT RUN" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_SET_FOCUSED=0)"
# AND WHICH SIDE OF THE BOUNDARY IT IS ON, which is the whole reason the blur
# is read at all: the same absence means two different faults, in two different
# processes, and a sentence that named one of them by symmetry would send the
# next person to the wrong one.
expect "a blur with no reach still blames this renderer" "yes" \
  "$(blames "ON THIS SIDE" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_BLUR=1 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0)"
expect "no blur at all blames the browser process instead" "yes" \
  "$(blames "browser process" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_BLUR=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
expect "no blur at all does not blame this renderer" "no" \
  "$(blames "ON THIS SIDE" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_BLUR=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
# AND THE DISPATCH THAT DID NOT TRAVEL, which is a third thing again: the event
# fired on the element and never reached the document. Asked before the branch
# is blamed, because an event that fired is not a branch that did not run.
expect "an event heard only at the element is its own failure" "fail" \
  "$(verdict 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
expect "an event heard only at the element blames the event, not the branch" \
  "yes" "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
expect "an element that said nothing at all does not blame bubbling" "no" \
  "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0)"
# AND THE ORDER THE TWO ARE ASKED IN, which is the whole reason this chain is
# ordered: with neither reading, the press never arriving is what happened.
expect "neither reading blames the hit test rather than the crossing" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0 SAW_REACHED=0)"

echo
echo "what the engine itself said, which is the layer the page cannot report"
# THE THREE THAT READ IDENTICALLY FROM THE PAGE. Every reading above is a
# listener in a document, so all of them go quiet together — and the engine
# never running, the engine running and the page not hearing, and a handler
# that never returned are three faults in three layers with one symptom. These
# are the arms that tell them apart, and they are asked BEFORE the blur, which
# only ever said which side of the process boundary to look on.
expect "an announcement that never finished blames the handler" "yes" \
  "$(blames "DID NOT COME OUT" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_ANNOUNCED=0)"
expect "an announcement that finished, unheard, blames the event" "yes" \
  "$(blames "NOTHING IN THE DOCUMENT HEARD" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0)"
# AND THE ONE THAT IS STILL THE FORK'S OWN CODE: the engine said nothing, so
# SetFocused never ran with received=true, whatever the element ended up as.
# Every step reported and still nothing announced: the one arm left, and
# the only one that says the fault is inside the announcement itself.
expect "no announcement with every step reported blames the last two lines" \
  "yes" "$(blames "ON THIS SIDE" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0)"
expect "no announcement at all does not blame the event" "no" \
  "$(blames "NOTHING IN THE DOCUMENT HEARD" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_SET_FOCUSED=0)"
# An event that fired at the element is still the bubbling arm, announced or
# not: the dispatch demonstrably happened, so which layer it happened in is
# no longer the question.
expect "an event heard at the element outranks the engine's own lines" "yes" \
  "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
# And the browser-process arm survives all of it: with no blur AND no
# announcement, nothing crossed into this renderer at all.
expect "no blur and no announcement still blames the browser process" "yes" \
  "$(blames "browser process" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_BLUR=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"

echo
echo "which step of the fork's own path stopped, once nothing was announced"
# THREE STEPS, ASKED OUTWARDS IN. Run 193 read activeElement=webview with
# nothing announced, which four different faults produce and which no reading
# taken in the page can separate: the branch not running, the owner not
# casting, the focus being refused, and the override not being on the path.
silent() { # the run 193 shape, then overrides
  blames "$1" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_ANNOUNCING=0     SAW_ANNOUNCED=0 "${@:2}"
}
expect "a branch that never saw a webview is named first" "yes" \
  "$(silent "NEVER SAW A <webview>" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
expect "a branch that ran and was refused names the refusal" "yes" \
  "$(silent "FOCUS WAS REFUSED" SAW_FOCUSED_IT=0 SAW_SET_FOCUSED=0)"
expect "a focus that took, with no override, names the override" "yes" \
  "$(silent "OVERRIDE DID NOT RUN" SAW_SET_FOCUSED=0)"
# AND THE ORDER, which is the point of asking them outwards in: a run with none
# of the three is the first arm, not the last, because a branch that never ran
# explains the two readings after it and they do not explain it.
expect "a branch that never ran does not blame the override" "no" \
  "$(silent "OVERRIDE DID NOT RUN" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
expect "a branch that never ran does not blame the refusal" "no" \
  "$(silent "FOCUS WAS REFUSED" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"

echo
echo "activeElement, which is a reading short rather than a failure"
expect "a reach with no activeElement is still a pass" "pass" \
  "$(verdict 0 SAW_ACTIVE=0)"
expect "a reach with no activeElement says what it is missing" "pass" \
  "$(verdict 0 SAW_ACTIVE=0)"
expect "activeElement is checked after the readings it cannot excuse" "fail" \
  "$(verdict 0 SAW_ACTIVE=0 SAW_REACHED=0)"

echo
echo "the control run — nothing clicked in the window, so nothing may cross"
expect "nothing reached is the pass" "pass" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0)"
expect "a reach is the failure" "fail" "$(verdict 1 SAW_GUEST=0)"
expect "a reach says the positive run would be measuring the configuration" \
  "yes" "$(blames "not evidence" 1 SAW_GUEST=0)"
# The press landing in the guest at all means the two runs differ somewhere
# other than where they were meant to, and the geometry is the only thing that
# decides where a press lands.
expect "a press in the guest is the control's failure" "fail" "$(verdict 1)"
expect "a press in the guest blames the geometry" "yes" \
  "$(blames "geometry" 1)"
# The control is a control whatever the rest of the readings say: it never
# clicks into the window, so what the window contains is not its business.
expect "an empty window is not the control's business" "pass" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0 SAW_PAGE=0)"
expect "activeElement is not the control's business" "pass" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0 SAW_ACTIVE=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the click guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
