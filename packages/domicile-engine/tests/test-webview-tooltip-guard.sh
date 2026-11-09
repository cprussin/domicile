#!/usr/bin/env bash
# Tests the verdict of `guard-webview-tooltip.sh`: which readings pass and
# which component a failure blames.
#
# Key cases:
#
#   - A tooltip away from the pointer fails: it is in the frame's coordinates.
#   - A tooltip with no delay fails: Chrome waits before showing one.
#   - In the control, any tooltip fails: the pointer never crossed the title.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-tooltip.sh"
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
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_TOOLTIP=1
    SAW_PLACED=1
    SAW_DELAYED=1
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

# The control rests beside the frame, so it hears nothing.
control() { verdict 1 SAW_TOOLTIP=0 SAW_PLACED=0 SAW_DELAYED=0 "$@"; }

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no move in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"

echo
echo "the positive run: the pointer over the frame's title"
expect "a placed, delayed tooltip is the pass" "pass" "$(verdict 0)"
expect "no tooltip blames DomicileTooltip" "yes" \
  "$(blames "DomicileTooltip" 0 SAW_TOOLTIP=0 SAW_PLACED=0 SAW_DELAYED=0)"
expect "a misplaced tooltip is a failure" "fail" "$(verdict 0 SAW_PLACED=0)"
expect "a misplaced tooltip names the frame's coordinates" "yes" \
  "$(blames "frame's own coordinates" 0 SAW_PLACED=0)"
expect "an immediate tooltip is a failure" "fail" "$(verdict 0 SAW_DELAYED=0)"
expect "an immediate tooltip says to wait" "yes" \
  "$(blames "must wait" 0 SAW_DELAYED=0)"

echo
echo "the control run: the pointer beside the frame"
expect "hearing nothing is the pass" "pass" "$(control)"
expect "any tooltip is the control's failure" "fail" "$(control SAW_TOOLTIP=1)"
expect "an empty window is the control's failure too" "fail" \
  "$(control SAW_PAGE=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the tooltip guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
