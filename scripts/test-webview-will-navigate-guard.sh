#!/usr/bin/env bash
# Tests the verdict of `guard-webview-will-navigate.sh`: which readings pass
# and which component a failure blames.
#
# The run cancels /blocked; the control cancels nothing. Runs the verdict block from the real guard, so
# moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-will-navigate.sh"
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
  SAW_SHELL=1
  SAW_CRASH=0
  SAW_DONE=1
  SERVED_START=1
  SERVED_SHELL_SET=1
  if [ "$NEGATIVE" = "1" ]; then
    ASKED="/blocked"
    SERVED_BLOCKED=1
    SERVED_ALLOWED=0
  else
    ASKED="/blocked /allowed"
    SERVED_BLOCKED=0
    SERVED_ALLOWED=1
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
expect "no shell is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a crash is a failure" "fail" "$(verdict 0 SAW_CRASH=1)"
expect "a crash names the throttle" "yes" \
  "$(blames "WillNavigateThrottle" 0 SAW_CRASH=1)"
expect "no page is a failure" "fail" "$(verdict 0 SERVED_START=0)"
expect "no event is a failure" "fail" "$(verdict 0 ASKED=)"
expect "and names where the throttle is added" "yes" \
  "$(blames "MaybeCreateAndAdd" 0 ASKED=)"

echo
echo "the run — the shell cancels /blocked"
expect "/blocked asked and never requested, /allowed served: pass" "pass" \
  "$(verdict 0)"
expect "/blocked requested anyway is a failure" "fail" \
  "$(verdict 0 SERVED_BLOCKED=1)"
expect "and says the cancel did not hold" "yes" \
  "$(blames "CANCEL DID NOT HOLD" 0 SERVED_BLOCKED=1)"
expect "/allowed never requested is a failure" "fail" \
  "$(verdict 0 SERVED_ALLOWED=0)"
expect "and names Answered" "yes" \
  "$(blames "Answered" 0 SERVED_ALLOWED=0)"
expect "the shell's src never served is a failure" "fail" \
  "$(verdict 0 SERVED_SHELL_SET=0)"
expect "the shell's src asking is a failure" "fail" \
  "$(verdict 0 'ASKED="/blocked /allowed /shell-set"')"
expect "and names AsksBeforeNavigating" "yes" \
  "$(blames "AsksBeforeNavigating" 0 'ASKED="/start /blocked /allowed"')"

echo
echo "the control — nothing canceled"
expect "/blocked asked and requested: pass" "pass" "$(verdict 1)"
expect "/blocked never requested is a failure" "fail" \
  "$(verdict 1 SERVED_BLOCKED=0)"
expect "asking about /allowed too is a failure" "fail" \
  "$(verdict 1 'ASKED="/blocked /allowed"')"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the will-navigate guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
