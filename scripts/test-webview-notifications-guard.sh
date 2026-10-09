#!/usr/bin/env bash
# Tests the verdict of `guard-webview-notifications.sh`: which readings pass
# and which component a failure blames.
#
# Runs the verdict block from the real guard, so moving it fails here. The
# control's second leg passes on an absent color, but only if its first leg
# found one.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-notifications.sh"
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

says() { # $1 MEASURED, $2 what the failure must contain
  (
    MEASURED="$1"
    eval "$BLOCK"
    case "$FAILURE" in
    *"$2"*) echo yes ;;
    *) echo no ;;
    esac
  )
}

echo "the claim — a page asking about notifications, which must be asked for"
expect "found is a pass" "pass" "$(verdict "notifications 0")"
expect "absent is a failure" "fail" "$(verdict "notifications 1")"
expect "absent names the patch" "yes" "$(says "notifications 1" "0104")"
expect "nothing drawn is a failure" "fail" "$(verdict "notifications 2")"
expect "nothing drawn blames the harness" "yes" "$(says "notifications 2" "harness")"
expect "an unusable probe fails" "fail" "$(verdict "notifications 3")"

echo
echo "the control — a page painting unasked, then one asking about a seeded geolocation"
expect "shown then held is the pass" "pass" "$(verdict "control 0 1")"
expect "geolocation still asked for is a failure" "fail" "$(verdict "control 0 0")"
expect "and says the seeded profile was not read" "yes" \
  "$(says "control 0 0" "seeded")"
expect "a first leg that saw nothing fails, however right the second looks" \
  "fail" "$(verdict "control 1 1")"
expect "and so does one whose second leg found it" "fail" \
  "$(verdict "control 1 0")"
expect "a first leg that measured nothing fails" "fail" "$(verdict "control 2 1")"
expect "a second leg that measured nothing fails" "fail" "$(verdict "control 0 2")"
expect "an unusable probe fails the second leg" "fail" "$(verdict "control 0 3")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the browser window notifications guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
