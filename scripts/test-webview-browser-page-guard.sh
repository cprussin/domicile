#!/usr/bin/env bash
# Tests the verdict of `guard-webview-browser-page.sh`: which readings pass and
# which component a failure blames.
#
# The control passes on the opposite reading from the run: the refusal must
# appear in the run and must not appear in the control. Runs the verdict block
# from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-browser-page.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

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

# A passing run of the given mode; each case changes one reading.
readings() { # $1 NEGATIVE, then NAME=value overrides
  NEGATIVE="$1"
  SAW_GUEST=1
  SAW_CRASH=0
  ANSWERED=1
  if [ "$NEGATIVE" = "1" ]; then
    SAW_SECOND=1
    SAW_REFUSAL=0
  else
    SAW_SECOND=0
    SAW_REFUSAL=1
  fi
  shift
  for override in "$@"; do
    eval "$override"
  done
}

verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
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

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(
    readings "$@"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "no guest is a failure" "fail" "$(verdict 0 SAW_GUEST=0)"
expect "no guest is a failure in the control too" "fail" "$(verdict 1 SAW_GUEST=0)"
expect "no guest names the guest" "yes" "$(blames "guest" 0 SAW_GUEST=0)"

echo
echo "the run — chrome://history in a browser window"
expect "a refusal and a live browser is the pass" "pass" "$(verdict 0)"
expect "a signal is a failure" "fail" "$(verdict 0 SAW_CRASH=1)"
# An engine without patch 0083 both crashes and does not refuse. The crash is
# the bug, so it is named first.
expect "a signal names where it landed, even with no refusal" "yes" \
  "$(blames "TabInterface" 0 SAW_CRASH=1 SAW_REFUSAL=0)"
expect "no refusal is a failure" "fail" "$(verdict 0 SAW_REFUSAL=0)"
expect "no refusal names the throttle" "yes" \
  "$(blames "BrowserPageThrottle" 0 SAW_REFUSAL=0)"
expect "a browser gone with no signal is a failure" "fail" \
  "$(verdict 0 ANSWERED=0)"
expect "a browser gone with no signal says no signal" "yes" \
  "$(blames "no signal" 0 ANSWERED=0)"

echo
echo "the control — an ordinary page in the same window"
expect "a second load and no refusal is the pass" "pass" "$(verdict 1)"
expect "a refusal in the control is a failure" "fail" \
  "$(verdict 1 SAW_REFUSAL=1)"
expect "a refusal in the control says the run's is no reading" "yes" \
  "$(blames "no reading" 1 SAW_REFUSAL=1)"
expect "a second page that never loaded is a failure" "fail" \
  "$(verdict 1 SAW_SECOND=0)"
expect "a crash in the control is a failure" "fail" "$(verdict 1 SAW_CRASH=1)"
expect "a control browser gone with no signal is a failure" "fail" \
  "$(verdict 1 ANSWERED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the browser-page guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
