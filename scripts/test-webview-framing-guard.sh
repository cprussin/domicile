#!/usr/bin/env bash
# Which end the framing guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-framing.sh` — the `case` that
# turns the colour probe's exit status and the run's mode into either a pass or
# one sentence naming an end. Eight answers come out of four statuses and two
# modes, and six of them are failures that read alike: "the <webview> showed
# nothing", "the page never drew", "the probe never ran". Naming one of those
# as another is the same class of defect as a guard that measures the wrong
# pixel, and it costs a CI cycle each time.
#
# It matters most for the two that are inverted. In the negative run, the probe
# FINDING the colour is the failure and NOT finding it is the pass — so a
# verdict written by symmetry with the positive run passes the control on a
# broken engine and fails it on a working one.
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

# Runs the real block against one probe status in one mode, and says which of
# the two outcomes it chose. Not the sentence: the sentences are prose and
# will be reworded, and a test that pinned them would fail for edits that
# changed no behaviour. Which end is blamed is asserted separately, by the word
# that names it.
verdict() { # $1 probe status, $2 NEGATIVE
  (
    PROBE_STATUS="$1"
    NEGATIVE="$2"
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
reason() { # $1 probe status, $2 NEGATIVE
  (
    PROBE_STATUS="$1"
    NEGATIVE="$2"
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

echo "the positive run — a <webview>, which must show the refused site"
# 0: the framed page's colour is on screen. That is the whole claim.
expect "found is a pass" "pass" "$(verdict 0 0)"
# 1: the page drew, the framed colour did not. The guest is what failed.
expect "absent is a failure" "fail" "$(verdict 1 0)"
expect "absent blames the element, not the harness" "yes" \
  "$(case "$(reason 1 0)" in *"<webview> showed nothing"*) echo yes ;; *) echo no ;; esac)"
# 2: not even the page's own background. Nothing was measured.
expect "nothing measured is a failure" "fail" "$(verdict 2 0)"
expect "nothing measured blames the harness" "yes" \
  "$(case "$(reason 2 0)" in *"harness"*) echo yes ;; *) echo no ;; esac)"

echo
echo "the negative run — an <iframe>, which must show nothing"
# THE INVERTED PAIR. A verdict written by symmetry gets both of these wrong.
expect "found is a failure" "fail" "$(verdict 0 1)"
expect "found says the site is not refusing anything" "yes" \
  "$(case "$(reason 0 1)" in *"X-Frame-Options"*) echo yes ;; *) echo no ;; esac)"
expect "absent is the pass" "pass" "$(verdict 1 1)"
# Not inverted, and that is the point of asserting it: a control that cannot
# see the page has established nothing, in either mode.
expect "nothing measured is still a failure" "fail" "$(verdict 2 1)"

echo
echo "a probe that did not run at all"
# The probe's own usage/connect failure, which is 3, and anything else a
# process can exit with — a signal, say. Neither mode may read one as a
# measurement.
expect "an unusable probe fails the positive run" "fail" "$(verdict 3 0)"
expect "an unusable probe fails the negative run" "fail" "$(verdict 3 1)"
expect "a killed probe fails rather than passing" "fail" "$(verdict 137 1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the framing guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
