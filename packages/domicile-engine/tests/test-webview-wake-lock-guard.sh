#!/usr/bin/env bash
# Tests the verdict of `guard-webview-wake-lock.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: the shell not hearing a lock only means something
# once the page holds one. Key cases:
#
#   - A page that held a lock the shell never heard of blames the count.
#   - A lock the page released that the shell still thinks is held fails: the
#     pill would name a site that no longer keeps the screens on.
#   - In the control, any report fails: the page asked for nothing.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-wake-lock.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the column-zero `fi` that ends the decision.
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

# Runs the block with every reading at its passing value; each case overrides
# one. Prints "pass", "fail" or "neither", then the failure on the next line.
judge() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_REFUSED=0
    SAW_PAGE_HELD=1
    SAW_PAGE_RELEASED=1
    SAW_HELD=1
    SAW_LET_GO=1
    SAW_ANY=1
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

verdict() { judge "$@" | head -1; }

blames() { # $1 word, then the args judge takes
  local word="$1"
  shift
  case "$(judge "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# The control's page asks for nothing, so nothing is heard.
control() {
  verdict 1 SAW_PAGE_HELD=0 SAW_PAGE_RELEASED=0 SAW_HELD=0 SAW_LET_GO=0 \
    SAW_ANY=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "and blames the harness" "yes" "$(blames "harness" 0 SAW_SHELL=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "an empty window is the control's failure too" "fail" \
  "$(control SAW_PAGE=0)"

echo
echo "the positive run -- the page holds a lock, then releases it"
expect "hearing it held and let go is the pass" "pass" "$(verdict 0)"
expect "a refused request is a failure" "fail" "$(verdict 0 SAW_REFUSED=1)"
expect "and names the permission" "yes" \
  "$(blames "permission" 0 SAW_REFUSED=1)"
expect "a request that never settled is a failure" "fail" \
  "$(verdict 0 SAW_PAGE_HELD=0)"
expect "a lock the shell never heard blames the count" "yes" \
  "$(blames "ScreenWakeLockChanged" 0 SAW_HELD=0)"
expect "a lock still heard after release is a failure" "fail" \
  "$(verdict 0 SAW_LET_GO=0)"
expect "and blames CancelWakeLock" "yes" \
  "$(blames "CancelWakeLock" 0 SAW_LET_GO=0)"

echo
echo "the control run -- a page that asks for nothing"
expect "hearing nothing is the pass" "pass" "$(control)"
expect "any report is the control's failure" "fail" "$(control SAW_ANY=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the wake lock guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
