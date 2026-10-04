#!/usr/bin/env bash
# Tests the verdict of `guard-webview-click.sh`: which readings pass and which
# component a failure blames.
#
# The verdict is an ordered `if` chain over many readings. A wrong order still
# prints a plausible sentence about the wrong layer, so each arm is tested.
# Easy to get backward:
#
#   - In the control run, the element being reached is the failure, and so is
#     a press that lands in the guest.
#   - A press that never reached the guest blames the harness, not the defect.
#   - The element not being activeElement still passes: the shell acts on the
#     focus event and never reads activeElement.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-click.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the column-zero `fi` that ends the decision. The nested
# `fi` is indented, so the match cannot stop early.
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

# A run where every reading is true; each case overrides one by name, which
# reads better than positional arguments.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_REACHED=1
    SAW_FOCUSIN=1
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

# The failure message, for cases that check which component it blames. Tests
# match a keyword, not the whole sentence.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_REACHED=1
    SAW_FOCUSIN=1
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
# The control must fail too: with no page, nothing being reached is also what
# a broken harness looks like.
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
# An empty window means the guest was never created. Only the positive run
# checks this; the control never clicks into the window.
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
# Looks like the defect but is not: nothing landed in the guest, so nothing
# had to cross out of it.
expect "a press that never reached the guest is a failure" "fail" \
  "$(verdict 0 SAW_GUEST=0)"
expect "a press that never reached the guest blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0)"
expect "a press that never reached the guest is not read as the defect" "no" \
  "$(blames "THE DEFECT" 0 SAW_GUEST=0)"
# With SAW_AT_ELEMENT=0 the element heard nothing; an event that fired but did
# not travel is a different arm. With the step readings set, the guard knows
# the focus took and the override did not run.
expect "a press that landed and did not cross is the defect" "yes" \
  "$(blames "OVERRIDE DID NOT RUN" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_SET_FOCUSED=0)"
# The blur says which side of the process boundary the fault is on. The same
# absence means different faults in different processes.
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
# The event fired on the element but never reached the document. This is
# checked before the branch is blamed.
expect "an event heard only at the element is its own failure" "fail" \
  "$(verdict 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
expect "an event heard only at the element blames the event, not the branch" \
  "yes" "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
expect "an element that said nothing at all does not blame bubbling" "no" \
  "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0)"
# With neither reading, the press never arrived, so the hit test is blamed.
expect "neither reading blames the hit test rather than the crossing" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0 SAW_REACHED=0)"

echo
echo "what the engine itself said, which is the layer the page cannot report"
# Every page reading is a document listener, so they all go quiet together.
# These engine log lines tell apart three faults with that one symptom: the
# engine never ran, the page did not hear it, or the handler never returned.
# They are checked before the blur.
expect "an announcement that never finished blames the handler" "yes" \
  "$(blames "DID NOT COME OUT" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_ANNOUNCED=0)"
expect "an announcement that finished, unheard, blames the event" "yes" \
  "$(blames "NOTHING IN THE DOCUMENT HEARD" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0)"
# The engine said nothing, so SetFocused never ran with received=true. With
# every earlier step reported, the fault is inside the announcement itself.
expect "no announcement with every step reported blames the last two lines" \
  "yes" "$(blames "ON THIS SIDE" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0)"
expect "no announcement at all does not blame the event" "no" \
  "$(blames "NOTHING IN THE DOCUMENT HEARD" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_SET_FOCUSED=0)"
# An event that fired at the element is the bubbling arm whether or not it
# was announced.
expect "an event heard at the element outranks the engine's own lines" "yes" \
  "$(blames "does not travel" 0 SAW_REACHED=0 SAW_AT_ELEMENT=1)"
# With no blur and no announcement, nothing reached this renderer.
expect "no blur and no announcement still blames the browser process" "yes" \
  "$(blames "browser process" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_BLUR=0 \
    SAW_ANNOUNCING=0 SAW_ANNOUNCED=0 SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"

echo
echo "which step of the fork's own path stopped, once nothing was announced"
# activeElement=webview with nothing announced has four possible causes that
# no page reading can separate: the branch did not run, the owner cast
# failed, focus was refused, or the override was not on the path. The steps
# are checked from the outermost in.
silent() { # nothing announced, then overrides
  blames "$1" 0 SAW_REACHED=0 SAW_AT_ELEMENT=0 SAW_ANNOUNCING=0     SAW_ANNOUNCED=0 "${@:2}"
}
expect "a branch that never saw a webview is named first" "yes" \
  "$(silent "NEVER SAW A <webview>" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
expect "a branch that ran and was refused names the refusal" "yes" \
  "$(silent "FOCUS WAS REFUSED" SAW_FOCUSED_IT=0 SAW_SET_FOCUSED=0)"
expect "a focus that took, with no override, names the override" "yes" \
  "$(silent "OVERRIDE DID NOT RUN" SAW_SET_FOCUSED=0)"
# A branch that never ran explains the later readings, so it is named first.
expect "a branch that never ran does not blame the override" "no" \
  "$(silent "OVERRIDE DID NOT RUN" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"
expect "a branch that never ran does not blame the refusal" "no" \
  "$(silent "FOCUS WAS REFUSED" SAW_BRANCH=0 SAW_FOCUSED_IT=0 \
    SAW_SET_FOCUSED=0)"

echo
echo "the focus event, which every focus-based handler in a shell is written against"
# Popover dismissal, focus traps and React's onFocus all listen for `focusin`,
# so the engine's own event alone is not enough.
expect "an announcement with no focusin is a failure" "fail" \
  "$(verdict 0 SAW_FOCUSIN=0)"
expect "an announcement with no focusin names the focus event" "yes" \
  "$(blames "NO FOCUS EVENT" 0 SAW_FOCUSIN=0)"
expect "no focusin is asked after the reach it cannot explain" "no" \
  "$(blames "NO FOCUS EVENT" 0 SAW_FOCUSIN=0 SAW_REACHED=0 SAW_AT_ELEMENT=0)"
expect "a focusin with nothing clicked is the control's failure" "fail" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0)"

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
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0 SAW_FOCUSIN=0)"
expect "a reach is the failure" "fail" "$(verdict 1 SAW_GUEST=0)"
expect "a reach says the positive run would be measuring the configuration" \
  "yes" "$(blames "not evidence" 1 SAW_GUEST=0)"
# A press in the guest means the two runs differ in geometry, which decides
# where a press lands.
expect "a press in the guest is the control's failure" "fail" "$(verdict 1)"
expect "a press in the guest blames the geometry" "yes" \
  "$(blames "geometry" 1)"
# The control never clicks into the window, so the window's contents and
# activeElement do not matter.
expect "an empty window is not the control's business" "pass" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0 SAW_FOCUSIN=0 SAW_PAGE=0)"
expect "activeElement is not the control's business" "pass" \
  "$(verdict 1 SAW_GUEST=0 SAW_REACHED=0 SAW_FOCUSIN=0 SAW_ACTIVE=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the click guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
