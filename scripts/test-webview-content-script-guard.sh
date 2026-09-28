#!/usr/bin/env bash
# Which end the content-script guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-content-script.sh`, run out
# of the real script rather than copied, as `test-webview-framing-guard.sh`
# does. The case that matters most: a control whose first leg found nothing
# must fail however right its second leg looks, because "no mark in the
# <webview>" and "no extension at all" are the same picture.
#
# Plus one fact the guard cannot check at runtime: the color it looks for is
# the one the fixture extension paints.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-content-script.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

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

# Pass or fail, not the sentence: the sentences will be reworded.
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

# Whether the failing sentence names `$2`, for where WHICH end it blames is
# the point.
says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "the claim — a <webview>, whose page the content script must mark"
expect "found is a pass" "pass" "$(verdict "webview 0")"
expect "absent is a failure" "fail" "$(verdict "webview 1")"
expect "absent blames the content script, not the harness" "yes" \
  "$(says "webview 1" "content script")"
expect "nothing measured is a failure" "fail" "$(verdict "webview 2")"
expect "nothing measured blames the harness" "yes" \
  "$(says "webview 2" "harness")"
expect "an unusable probe fails" "fail" "$(verdict "webview 3")"
expect "and a killed one does not pass either" "fail" "$(verdict "webview 137")"

echo
echo "the control — the extension top-level, then the <webview> without it"
expect "marked top-level, unmarked without it, is the pass" "pass" \
  "$(verdict "control 0 1")"

# INVERTED: the second leg finding the color is the failure.
expect "a mark with no extension loaded is a failure" "fail" \
  "$(verdict "control 0 0")"
expect "and says the color is not the content script's" "yes" \
  "$(says "control 0 0" "not the content script")"

# THE CASE THE ORDER IS FOR.
expect "a first leg with no mark fails, however right the second looks" \
  "fail" "$(verdict "control 1 1")"
expect "and names the extension's loading" "yes" \
  "$(says "control 1 1" "--load-extension")"
expect "and it fails the same way when the second leg found the mark" "fail" \
  "$(verdict "control 1 0")"

expect "a first leg that measured nothing is a failure" "fail" \
  "$(verdict "control 2 1")"
expect "a second leg that measured nothing is a failure" "fail" \
  "$(verdict "control 0 2")"
expect "and blames the guest page never drawing" "yes" \
  "$(says "control 0 2" "guest")"
expect "an unusable probe fails the first leg" "fail" "$(verdict "control 3 1")"
expect "an unusable probe fails the second leg" "fail" "$(verdict "control 0 3")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0")"

echo
echo "the fixture"
COLOR="$(sed -n 's/^readonly COLOR="\([0-9A-F]\{6\}\)"$/\1/p' "$GUARD")"
expect "the guard names its color" "yes" \
  "$([ -n "$COLOR" ] && echo yes || echo no)"
expect "and the content script paints it" "yes" \
  "$(grep -qi "#$COLOR" "$SCRIPTS/guard-webview-content-script-extension/content.js" 2>/dev/null &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the content-script guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
