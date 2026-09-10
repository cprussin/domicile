#!/usr/bin/env bash
# Which end the framing guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-framing.sh` — the `case` that
# turns what a run measured into either a pass or one sentence naming an end.
# Eleven answers come out of it and most are failures that read alike: "the
# <webview> showed nothing", "the page never drew", "the probe never ran".
# Naming one of those as another is the same class of defect as a guard that
# measures the wrong pixel, and it costs a CI cycle each time.
#
# It matters most in the control, where the probe FINDING the framed colour is
# the failure and NOT finding it is the pass — so a verdict written by symmetry
# with the positive run passes the control on a broken engine and fails it on a
# working one.
#
# AND IT MATTERS MOST OF ALL FOR THE CONTROL'S FIRST LEG. The control is two
# runs: an <iframe> on an ordinary http page framing a page that permits it,
# then the same frame on the same page framing the one that refuses. Only the
# second is the claim; the first is what makes it a claim, because an empty
# frame and a harness that cannot draw are the same picture. A control whose
# first leg found nothing must fail no matter how right its second leg looks —
# that is the case this guard shipped wrong once already, when the frame was on
# a domicile:// document that could not load the page in either leg.
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-framing.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `esac` that closes the decision. Both ends are whole
# lines, so this cannot half-match, and the block stops before the two `exit`
# lines below it — a verdict is a value here, not a status.
BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
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

# Runs the real block against one run's measurement, and says which of the two
# outcomes it chose. Not the sentence: the sentences are prose and will be
# reworded, and a test that pinned them would fail for edits that changed no
# behaviour. Which end is blamed is asserted separately, by the word that names
# it.
#
# `MEASURED` is what a run comes to: the mode, and then a probe status for each
# leg it ran. One string rather than three variables because it is one decision
# — the control's second leg means nothing without its first, and a `case` over
# the pair says that where two nested `if`s would only imply it.
verdict() { # $1 MEASURED
  (
    MEASURED="$1"
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
reason() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

# And the passing one, for the same reason in the other direction.
claim() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    echo "$PASSED"
  )
}

says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(reason "$1")" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "the positive run — a <webview>, which must show the refused site"
# 0: the framed page's colour is on screen. That is the whole claim.
expect "found is a pass" "pass" "$(verdict "webview 0")"
# 1: the page drew, the framed colour did not. The guest is what failed.
expect "absent is a failure" "fail" "$(verdict "webview 1")"
expect "absent blames the element, not the harness" "yes" \
  "$(says "webview 1" "<webview> showed nothing")"
# 2: not even the page's own background. Nothing was measured.
expect "nothing measured is a failure" "fail" "$(verdict "webview 2")"
expect "nothing measured blames the harness" "yes" \
  "$(says "webview 2" "harness")"
# The probe's own usage/connect failure, which is 3, and anything else a
# process can exit with — a signal, say.
expect "an unusable probe fails" "fail" "$(verdict "webview 3")"
expect "and a killed one does not pass either" "fail" "$(verdict "webview 137")"

echo
echo "the control — one <iframe>, framing the page that permits it and then the one that does not"
# THE PAIR THE CONTROL IS. The first leg says this harness can see a framed
# page here; the second says this page is not one it can see. Only both
# together are a reading of the headers.
expect "framed then refused is the pass" "pass" "$(verdict "control 0 1")"
expect "and says what the difference between the two legs was" "yes" \
  "$(case "$(claim "control 0 1")" in *"header"*) echo yes ;; *) echo no ;; esac)"

# THE INVERTED ONE. A verdict written by symmetry with the positive run gets
# this backwards.
expect "a refusing page that renders anyway is a failure" "fail" \
  "$(verdict "control 0 0")"
expect "and says the site is not refusing anything" "yes" \
  "$(says "control 0 0" "X-Frame-Options")"

# THE CASE THIS GUARD WAS REWRITTEN FOR. The second leg reads exactly like a
# pass — the refusing page is absent — and it means nothing, because the leg
# that was supposed to establish the harness can draw a framed page at all
# found nothing either. The old control was permanently in this state and
# reported the pass.
expect "a first leg that saw nothing fails, however right the second looks" \
  "fail" "$(verdict "control 1 1")"
expect "and says the harness could not show a framed page at all" "yes" \
  "$(says "control 1 1" "harness")"
expect "and it fails the same way when the second leg found the page" "fail" \
  "$(verdict "control 1 0")"

# Not inverted, and that is the point of asserting it: a leg that cannot see
# the page it is on has established nothing, in either position.
expect "a first leg that measured nothing is a failure" "fail" \
  "$(verdict "control 2 1")"
expect "a second leg that measured nothing is a failure" "fail" \
  "$(verdict "control 0 2")"
expect "an unusable probe fails the first leg" "fail" "$(verdict "control 3 1")"
expect "an unusable probe fails the second leg" "fail" "$(verdict "control 0 3")"

echo
echo "a run that measured nothing at all"
# Neither mode, or a mode with no legs in it: a verdict block that fell through
# to a pass would be the worst failure available to this file.
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the framing guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
