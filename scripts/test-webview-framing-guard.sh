#!/usr/bin/env bash
# Tests the verdict of `guard-webview-framing.sh`: which readings pass and
# which component a failure blames.
#
# Many failure messages sound alike ("the <webview> showed nothing", "the page
# never drew", "the probe never ran"), so each case checks the right one.
#
# The control has two legs: an <iframe> on an http page frames a page that
# permits it, then one that refuses. In the second leg, finding the color is
# the failure. The first leg proves the harness can draw a framed page, so if
# it found nothing the control fails regardless of the second leg.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-framing.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `esac` that ends the decision, stopping before the
# guard's `exit` lines.
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

# Prints pass, fail or neither for one measurement. Sentences are not
# compared, since they change; blame is checked by keyword.
#
# `MEASURED` is the mode followed by a probe status per leg. It is one string
# because the control's second leg means nothing without its first.
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

# The failure message, for cases that check which component it blames.
reason() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

# The pass message, for cases that check what it claims.
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
# 0: the framed page's color is on screen.
expect "found is a pass" "pass" "$(verdict "webview 0")"
# 1: the page drew but the framed color did not; the guest failed.
expect "absent is a failure" "fail" "$(verdict "webview 1")"
expect "absent blames the element, not the harness" "yes" \
  "$(says "webview 1" "<webview> showed nothing")"
# 2: not even the page's own background; nothing was measured.
expect "nothing measured is a failure" "fail" "$(verdict "webview 2")"
expect "nothing measured blames the harness" "yes" \
  "$(says "webview 2" "harness")"
# 3 is the probe's usage or connect failure; anything else (e.g. a signal)
# also fails.
expect "an unusable probe fails" "fail" "$(verdict "webview 3")"
expect "and a killed one does not pass either" "fail" "$(verdict "webview 137")"

echo
echo "the control — one <iframe>, framing the page that permits it and then the one that does not"
# The first leg shows the harness can see a framed page; the second shows
# this page is refused. Only together do they test the headers.
expect "framed then refused is the pass" "pass" "$(verdict "control 0 1")"
expect "and says what the difference between the two legs was" "yes" \
  "$(case "$(claim "control 0 1")" in *"header"*) echo yes ;; *) echo no ;; esac)"

# Inverted relative to the positive run.
expect "a refusing page that renders anyway is a failure" "fail" \
  "$(verdict "control 0 0")"
expect "and says the site is not refusing anything" "yes" \
  "$(says "control 0 0" "X-Frame-Options")"

# The second leg looks like a pass (the refusing page is absent) but means
# nothing when the first leg also found nothing.
expect "a first leg that saw nothing fails, however right the second looks" \
  "fail" "$(verdict "control 1 1")"
expect "and says the harness could not show a framed page at all" "yes" \
  "$(says "control 1 1" "harness")"
expect "and it fails the same way when the second leg found the page" "fail" \
  "$(verdict "control 1 0")"

# Not inverted: a leg that measured nothing fails in either position.
expect "a first leg that measured nothing is a failure" "fail" \
  "$(verdict "control 2 1")"
expect "a second leg that measured nothing is a failure" "fail" \
  "$(verdict "control 0 2")"
expect "an unusable probe fails the first leg" "fail" "$(verdict "control 3 1")"
expect "an unusable probe fails the second leg" "fail" "$(verdict "control 0 3")"

echo
echo "a run that measured nothing at all"
# No mode, or a mode with no legs, must not fall through to a pass.
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the framing guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
