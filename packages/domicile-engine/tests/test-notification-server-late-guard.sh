#!/usr/bin/env bash
# Tests the verdict of `guard-notification-server-late.sh`: which readings
# pass and which end a failure blames.
#
# Runs the verdict block from the real guard, so moving it fails here. The
# control's second leg passes on silence, but only if its first leg saw a call.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-notification-server-late.sh"
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
    NAME="org.freedesktop.Notifications"
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
    NAME="org.freedesktop.Notifications"
    eval "$BLOCK"
    case "$FAILURE" in
    *"$2"*) echo yes ;;
    *) echo no ;;
    esac
  )
}

echo "the claim — a server that takes its name after the browser looked"
expect "called is a pass" "pass" "$(verdict "late called")"
expect "silent is a failure" "fail" "$(verdict "late silent")"
expect "silent names the patch" "yes" "$(says "late silent" "0133")"
expect "never asked is a failure" "fail" "$(verdict "late unasked")"
expect "never asked blames the harness" "yes" "$(says "late unasked" "harness")"
expect "no bus is a failure" "fail" "$(verdict "late nobus")"

echo
echo "the control — a server there from the start, then none at all"
expect "called then silent is the pass" "pass" "$(verdict "control called silent")"
expect "a call with no server is a failure" "fail" \
  "$(verdict "control called called")"
expect "and says there was no server" "yes" \
  "$(says "control called called" "no notification server")"
expect "a second leg that never asked fails" "fail" \
  "$(verdict "control called unasked")"
expect "a first leg that saw nothing fails, however right the second looks" \
  "fail" "$(verdict "control silent silent")"
expect "a first leg with no bus fails" "fail" "$(verdict "control nobus silent")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant called")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the late notification server guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
