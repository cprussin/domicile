#!/usr/bin/env bash
# Which end the routed-link guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-routed-link.sh` — the `if`
# chain that turns seven readings and the run's mode into either a pass or one
# sentence naming an end. The readings are not independent: a run where the
# shell page never ran has established nothing, a run with no page in the
# window is not a run about a link at all, and "the browser was never asked" is
# only a finding once a press has landed on a link. So the chain is ordered,
# and an ordered chain is a thing that can be got wrong in a way no failing
# engine would ever reveal — the wrong arm answers, with a true-sounding
# sentence about the wrong layer, and the next person spends a CI cycle on it.
#
# ONE ARM CARRIES THE WHOLE EXPERIMENT, and it is the one a verdict written by
# symmetry leaves out: the shell being asked for a window WITHOUT the engine
# having logged the routed-link line is a FAILURE, not the claim. Both halves
# of `WebViewGuest` send the same `NewWindowRequested` — `CreateCustomWebContents`
# for a `target="_blank"`, and `OpenURLFromTab` for this — so the shell's own
# event cannot tell them apart. Only the engine's line can. A guard that called
# an ask alone a pass would go green against a fork carrying #447 and no
# override at all, which is exactly the fork this change exists to improve on.
#
# THE SECOND ONE IS ABOUT THE BUTTON. The run and its control press the SAME
# POINT on the SAME LINK and differ only in which button. So a middle press
# that navigated the guest in place is not the defect this guard is about: it
# is the press having arrived as a left one — a driver that dropped the flag,
# or a build whose hit test ignores it — and blaming the delegate for that
# would send the next person into the browser process over an argument.
#
# The rest matter for the reasons the other webview guards' do:
#
#   in the control run, an ask is the failure, and so is a press that followed
#     no link — its absence of an ask means nothing if nothing was clicked
#   whether the browser was asked at all is what separates a gesture that never
#     reached the delegate from a delegate that took it and dropped it
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-routed-link.sh"
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

# A run in which everything the claim wants is true; each case below changes one
# reading. `SAW_MOVED=0` in the baseline because a middle press must NOT take
# the guest anywhere: the page moving is the CONTROL's positive reading, and a
# claim run that had it was pressed with the wrong button.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_ASKED=1
    SAW_MOVED=0
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
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_ASKED=1
    SAW_MOVED=0
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

# The control's own shape: it presses the same link with the left button, so the
# guest follows it in place, and the browser is asked for nothing.
control() { # the overrides a case adds
  verdict 1 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1 "$@"
}

controlBlames() { # $1 word, then overrides
  blames "$1" 1 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1 "${@:2}"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control run" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press that never reached the page is a failure" "fail" \
  "$(verdict 0 SAW_PRESS=0)"
expect "a press that never reached the page blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_PRESS=0)"

echo
echo "the positive run — a middle click on an ordinary link"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# THE ARM THE WHOLE GUARD TURNS ON. The shell was asked for a window and the
# engine never logged the routed-link line, so the ask came from
# CreateCustomWebContents — #447's path — and the delegate under test never ran.
expect "an ask with no routed line is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0)"
expect "an ask with no routed line blames the other path" "yes" \
  "$(blames "CreateCustomWebContents" 0 SAW_ROUTED=0)"
expect "an ask with no routed line is not read as a pass" "no" \
  "$(blames "the delegate took it" 0 SAW_ROUTED=0)"
# THE ONE THAT READS LIKE THE DEFECT AND IS NOT: the press arrived as a left
# one, so the run measured the control's gesture under the claim's name.
expect "a guest that moved in place is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
expect "a guest that moved in place blames the button" "yes" \
  "$(blames "button" 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
expect "a guest that moved in place does not blame the other path" "no" \
  "$(blames "CreateCustomWebContents" 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
# AND THE TWO SIDES OF A CLICK THAT DID NOTHING, which is the defect this guard
# exists to catch and which has two causes in two layers.
expect "nothing at all is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_ASKED=0)"
expect "nothing at all blames the routing" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_ROUTED=0 SAW_ASKED=0)"
expect "a routed line with no ask is a failure" "fail" "$(verdict 0 SAW_ASKED=0)"
expect "a routed line with no ask blames the report" "yes" \
  "$(blames "TOOK IT AND SAID NOTHING" 0 SAW_ASKED=0)"
expect "a routed line with no ask does not blame the routing" "no" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0)"
# A guest that both asked for a window AND went there itself has done the
# gesture twice, which is a worse desktop than doing it once wrongly.
expect "asking and moving both is a failure" "fail" "$(verdict 0 SAW_MOVED=1)"
expect "asking and moving both blames the double action" "yes" \
  "$(blames "TWICE" 0 SAW_MOVED=1)"

echo
echo "the control run — the same link, pressed with the left button"
expect "following the link in place is the pass" "pass" "$(control)"
expect "an ask is the control's failure" "fail" "$(control SAW_ASKED=1)"
expect "an ask says the positive run measures nothing" "yes" \
  "$(controlBlames "any press" SAW_ASKED=1)"
# The engine's line is the same finding one layer earlier: an ordinary left
# click has no business reaching this delegate.
expect "a routed line with no ask is the control's failure" "fail" \
  "$(control SAW_ROUTED=1)"
expect "a press that followed no link is the control's failure" "fail" \
  "$(control SAW_MOVED=0)"
expect "a press that followed no link blames the geometry" "yes" \
  "$(controlBlames "geometry" SAW_MOVED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the routed-link guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
