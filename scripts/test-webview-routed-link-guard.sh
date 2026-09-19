#!/usr/bin/env bash
# Which end the routed-link guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-routed-link.sh` — the `if`
# chain that turns eight readings and the run's mode into either a pass or one
# sentence naming an end. The readings are not independent: a run where the
# shell page never ran has established nothing, a run with no cross-site frame
# in the window is not a run about a navigation the browser routes, and "the
# top never moved" is only a finding once a press has landed on a link in that
# frame. So the chain is ordered, and an ordered chain is a thing that can be
# got wrong in a way no failing engine would ever reveal — the wrong arm
# answers, with a true-sounding sentence about the wrong layer, and the next
# person spends a CI cycle on it.
#
# ONE ARM CARRIES THE WHOLE EXPERIMENT, and it is the one a verdict written by
# symmetry leaves out: the top page arriving WITHOUT the browser having been
# asked is a FAILURE, not the claim. It means the iframe was in this process
# after all, so Blink retargeted the navigation itself and
# `WebContentsDelegate::OpenURLFromTab` — the whole subject — was never on the
# path. A guard that called that a pass would go green against a fork with no
# override at all.
#
# The rest matter for the reasons the other webview guards' do:
#
#   in the control run, the top moving is the failure, and so is a press that
#     followed no link — its absence of a navigation means nothing if nothing
#     was clicked
#   a press that followed the same-frame link in the POSITIVE run is geometry
#     rather than the defect: what that run measures was never clicked
#   whether the browser was asked at all is what separates a renderer that
#     never routed the navigation from a delegate that took it and dropped it
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
# reading. `SAW_STAYED=0` in the baseline because the claim's run clicks the
# other link: the framed page staying put is the CONTROL's positive reading, and
# a claim run that had it clicked the wrong half of the page.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_OUTER=1
    SAW_INNER=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_TOP=1
    SAW_STAYED=0
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
    SAW_OUTER=1
    SAW_INNER=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_TOP=1
    SAW_STAYED=0
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

# The control's own shape: it clicks the link that stays in the frame, so the
# top never moves, the browser is never asked, and the framed page navigates.
control() { # the overrides a case adds
  verdict 1 SAW_ROUTED=0 SAW_TOP=0 SAW_STAYED=1 "$@"
}

controlBlames() { # $1 word, then overrides
  blames "$1" 1 SAW_ROUTED=0 SAW_TOP=0 SAW_STAYED=1 "${@:2}"
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
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_OUTER=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_OUTER=0)"
# THE FIXTURE'S OWN HALF: with no framed page there is no remote frame, and a
# navigation the browser routes is the only thing this guard is about.
expect "a frame that never loaded is a failure" "fail" "$(verdict 0 SAW_INNER=0)"
expect "a frame that never loaded blames the fixture" "yes" \
  "$(blames "cross-site frame" 0 SAW_INNER=0)"
expect "a press that never reached the frame is a failure" "fail" \
  "$(verdict 0 SAW_PRESS=0)"
expect "a press that never reached the frame blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_PRESS=0)"

echo
echo "the positive run — a _top link in a cross-site frame"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# THE ARM THE WHOLE GUARD TURNS ON. The top moved and the browser was never
# asked, so the frame was same-process and Blink did it: the delegate under
# test never ran, and calling that a pass would go green against a fork that
# does not override it at all.
expect "a top that moved without the browser being asked is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0)"
expect "a top that moved without the browser being asked blames the process" \
  "yes" "$(blames "same process" 0 SAW_ROUTED=0)"
expect "a top that moved without the browser being asked is not read as a pass" \
  "no" "$(blames "the delegate took it" 0 SAW_ROUTED=0)"
# THE ONE THAT READS LIKE THE DEFECT AND IS NOT: the press landed on the
# control's link, so the run measured the wrong half of the page.
expect "a press on the same-frame link is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_TOP=0 SAW_STAYED=1)"
expect "a press on the same-frame link blames the geometry" "yes" \
  "$(blames "geometry" 0 SAW_ROUTED=0 SAW_TOP=0 SAW_STAYED=1)"
# AND THE TWO SIDES OF A TOP THAT NEVER MOVED, which is the defect this guard
# exists to catch and which has two causes in two layers.
expect "no navigation and no ask is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_TOP=0)"
expect "no navigation and no ask blames the routing" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_ROUTED=0 SAW_TOP=0)"
expect "an ask that went nowhere is a failure" "fail" "$(verdict 0 SAW_TOP=0)"
expect "an ask that went nowhere blames the load" "yes" \
  "$(blames "TOOK IT AND NOTHING ARRIVED" 0 SAW_TOP=0)"
expect "an ask that went nowhere does not blame the routing" "no" \
  "$(blames "NEVER ASKED" 0 SAW_TOP=0)"
# And the order: a run that clicked the wrong link has both of those readings
# missing too, so naming the crossing there would send the next person into the
# browser process over a press that landed two hundred pixels off.
expect "the wrong link outranks the layer the navigation stopped in" "no" \
  "$(blames "NEVER ASKED" 0 SAW_ROUTED=0 SAW_TOP=0 SAW_STAYED=1)"

echo
echo "the control run — a link that stays in the frame"
expect "staying in the frame is the pass" "pass" "$(control)"
expect "a top that moved is the failure" "fail" "$(control SAW_TOP=1)"
expect "a top that moved says the positive run measures nothing" "yes" \
  "$(controlBlames "any link" SAW_TOP=1)"
# The browser being asked at all is the same finding one layer earlier: a
# same-frame navigation has no business reaching the delegate.
expect "an ask with no navigation is the control's failure" "fail" \
  "$(control SAW_ROUTED=1)"
expect "a press that followed no link is the control's failure" "fail" \
  "$(control SAW_STAYED=0)"
expect "a press that followed no link blames the geometry" "yes" \
  "$(controlBlames "geometry" SAW_STAYED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the routed-link guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
