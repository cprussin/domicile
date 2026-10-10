#!/usr/bin/env bash
# Tests which step the resize guard blames and which results it passes.
#
# Runs the verdict block from `guard-webview-resize.sh` itself, not a copy,
# like the other guards' tests. Key cases: a frozen window after the burst
# fails and names the reading that stopped, and the control passes only when
# every reading holds.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-resize.sh"
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
    RESIZE_STEPS=1200
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

says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    RESIZE_STEPS=1200
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<mode> <shell> <drawn> <loaded> <pressed-before> <shown-before>
# <resized> <sized> <pressed-after> <shown-after>".
echo "the claim — a burst of resizes"
expect "every reading holding is the pass" "pass" \
  "$(verdict "burst 1 1 1 1 1 1 1 1 1")"
expect "a page that missed the last size is a failure" "fail" \
  "$(verdict "burst 1 1 1 1 1 1 0 1 1")"
expect "and says so" "yes" \
  "$(says "burst 1 1 1 1 1 1 0 1 1" "DID NOT GET THE LAST SIZE")"
expect "a page the second press missed is a failure" "fail" \
  "$(verdict "burst 1 1 1 1 1 1 1 0 0")"
expect "and says it takes no input" "yes" \
  "$(says "burst 1 1 1 1 1 1 1 0 0" "TAKES NO INPUT")"
expect "a page that took the press and drew nothing is a failure" "fail" \
  "$(verdict "burst 1 1 1 1 1 1 1 1 0")"
expect "and says it stopped drawing" "yes" \
  "$(says "burst 1 1 1 1 1 1 1 1 0" "STOPPED DRAWING")"
expect "a burst that never ended is a failure" "fail" \
  "$(verdict "burst 1 1 1 1 1 0 0 0 0")"

echo
echo "the harness — readings before any resize"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "burst 0 0 0 0 0 0 0 0 0")"
expect "a window never drawn is a failure" "fail" \
  "$(verdict "burst 1 0 0 0 0 0 0 0 0")"
expect "a page never loaded is a failure" "fail" \
  "$(verdict "still 1 1 0 0 0 0 0 0 0")"
expect "a first press that missed blames the harness" "yes" \
  "$(says "burst 1 1 1 0 0 0 0 0 0" "harness")"
expect "a first capture that missed blames the harness" "yes" \
  "$(says "burst 1 1 1 1 0 0 0 0 0" "harness")"

echo
echo "the control — a strip that resizes nothing"
expect "every reading holding is the control's pass" "pass" \
  "$(verdict "still 1 1 1 1 1 1 1 1 1")"
expect "a frozen control is a failure" "fail" \
  "$(verdict "still 1 1 1 1 1 1 1 1 0")"
expect "and says the claim's readings say nothing" "yes" \
  "$(says "still 1 1 1 1 1 1 1 1 0" "say nothing")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" \
  "$(verdict "elephant 1 1 1 1 1 1 1 1 1")"

if [ "$FAILED" -eq 0 ]; then
  echo "the resize guard's verdict names the right step in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
