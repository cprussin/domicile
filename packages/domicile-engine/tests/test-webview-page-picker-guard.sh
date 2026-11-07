#!/usr/bin/env bash
# Tests the verdict of `guard-webview-page-picker.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a picker the shell never heard only means something
# once the browser asked. Key cases:
#
#   - A press that never asked blames OpenColorChooser or the binding.
#   - A picker heard without its box blames the anchor.
#   - In the control, any change fails: the shell canceled.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-page-picker.sh"
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
    SAW_GUEST=1
    SAW_ASKED=1
    SAW_HEARD=1
    SAW_ANSWERED=1
    SAW_SETTLED=1
    SAW_CHANGED=1
    SAW_ANY_CHANGE=1
    PICK="#ff8800"
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

# The control cancels, so the page never changes.
control() {
  verdict 1 SAW_CHANGED=0 SAW_ANY_CHANGE=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press on the shell blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"

echo
echo "the positive run: the shell picks a color"
expect "the picked color in the page is the pass" "pass" "$(verdict 0)"
expect "a press that never asked blames OpenColorChooser" "yes" \
  "$(blames "OpenColorChooser" 0 SAW_ASKED=0)"
expect "a picker heard wrong blames the anchor or the element" "yes" \
  "$(blames "anchor" 0 SAW_HEARD=0)"
expect "an answer the browser never logged blames Pick" "yes" \
  "$(blames "WebViewGuest::Pick" 0 SAW_SETTLED=0)"
expect "a color that never reached the page blames the chooser" "yes" \
  "$(blames "DomicileColorChooser" 0 SAW_CHANGED=0)"

echo
echo "the control run: the shell cancels"
expect "an unchanged page is the pass" "pass" "$(control)"
expect "any change is the control's failure" "fail" "$(control SAW_ANY_CHANGE=1)"
expect "a press that never asked fails the control too" "fail" \
  "$(control SAW_ASKED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the page picker guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
