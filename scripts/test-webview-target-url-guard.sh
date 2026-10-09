#!/usr/bin/env bash
# Tests the verdict of `guard-webview-target-url.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a link that was never reported only means something
# once the pointer reached the page. Key cases:
#
#   - A link reported and never cleared fails: the bubble would stay up after
#     the pointer left.
#   - A link not reported again when the pointer comes back onto it fails: the
#     renderer reports only changes, so the guest must.
#   - In the control, any report fails: the pointer never crossed the link.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-target-url.sh"
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
    SAW_LINK=1
    SAW_CLEARED=1
    SAW_BACK=1
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

# The control hovers only the strip, so it hears nothing.
control() { verdict 1 SAW_LINK=0 SAW_CLEARED=0 SAW_BACK=0 SAW_ANY=0 "$@"; }

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no move in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no move in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"

echo
echo "the positive run — the pointer over the link, then off it"
expect "the link and its clearing is the pass" "pass" "$(verdict 0)"
expect "no link is a failure" "fail" \
  "$(verdict 0 SAW_LINK=0 SAW_CLEARED=0 SAW_BACK=0)"
expect "no link blames UpdateTargetURL" "yes" \
  "$(blames "UpdateTargetURL" 0 SAW_LINK=0 SAW_CLEARED=0 SAW_BACK=0)"
expect "a link never cleared is a failure" "fail" "$(verdict 0 SAW_CLEARED=0)"
expect "a link never cleared says the bubble stays" "yes" \
  "$(blames "stays" 0 SAW_CLEARED=0)"
expect "a link not reported on coming back is a failure" "fail" \
  "$(verdict 0 SAW_BACK=0)"
expect "a link not reported on coming back blames PreHandleMouseEvent" "yes" \
  "$(blames "PreHandleMouseEvent" 0 SAW_BACK=0)"

echo
echo "the control run — the pointer on the strip only"
expect "hearing nothing is the pass" "pass" "$(control)"
expect "any report is the control's failure" "fail" "$(control SAW_ANY=1)"
expect "an empty window is the control's failure too" "fail" \
  "$(control SAW_PAGE=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the target-url guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
