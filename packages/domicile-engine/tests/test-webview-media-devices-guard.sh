#!/usr/bin/env bash
# Which end the media devices guard blames, and which runs it calls a pass.
#
# The unit is the verdict block in `guard-webview-media-devices.sh`, run out of
# the real script rather than copied, so a rewrite that moves it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-media-devices.sh"
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

# A positive run in which everything is true; each case changes one reading.
# Prints the verdict, then the failing sentence.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    LISTED="a,b"
    FIRST="a"
    LAST="b"
    SAW_BAD_KIND=1
    SAW_PREFERRED=1
    SAW_REFUSED=0
    RELISTED="b,a"
    RELISTED_FIRST="b"
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
    echo "$FAILURE"
  )
}

verdict() {
  run_block "$@" | head -1
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(run_block "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# The control's own shape: the id is refused and the order stays.
control() {
  verdict 1 SAW_PREFERRED=0 SAW_REFUSED=1 RELISTED="a,b" RELISTED_FIRST="a" "$@"
}

echo "a run that never got as far as choosing"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "and blames the harness" "yes" "$(blames "harness" 0 SAW_SHELL=0)"
expect "no cameras listed is a failure" "fail" "$(verdict 0 LISTED= FIRST= LAST=)"
expect "and names ListMediaDevices" "yes" \
  "$(blames "ListMediaDevices" 0 LISTED= FIRST= LAST=)"
expect "one camera is not enough to tell an order" "fail" \
  "$(verdict 0 LISTED=a FIRST=a LAST=a)"
expect "a bad kind that did not throw is a failure" "fail" \
  "$(verdict 0 SAW_BAD_KIND=0)"

echo
echo "the positive run"
expect "the preferred camera first is the pass" "pass" "$(verdict 0)"
expect "a rejected choice is a failure" "fail" "$(verdict 0 SAW_PREFERRED=0)"
expect "and names PreferMediaDevice" "yes" \
  "$(blames "PreferMediaDevice" 0 SAW_PREFERRED=0)"
expect "an order that did not change is a failure" "fail" \
  "$(verdict 0 RELISTED="a,b" RELISTED_FIRST=a)"

echo
echo "the control run -- an id no camera has"
expect "a refusal and the same order is the pass" "pass" "$(control)"
expect "an id accepted anyway is the control's failure" "fail" \
  "$(control SAW_REFUSED=0)"
expect "a refusal that still moved the order is a failure" "fail" \
  "$(control RELISTED="b,a" RELISTED_FIRST=b)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the media devices guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
