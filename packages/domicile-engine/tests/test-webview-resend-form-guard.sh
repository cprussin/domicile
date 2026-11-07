#!/usr/bin/env bash
# Tests the verdict of `guard-webview-resend-form.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a prompt the shell never heard only means something
# once the browser asked. Key cases:
#
#   - A reload never asked about blames ShowRepostFormWarningDialog.
#   - A yes that never sent the form again blames ContinuePendingReload.
#   - In the control, a second post fails: the shell said no.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-resend-form.sh"
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
    SAW_POSTED=1
    SAW_RELOADING=1
    SAW_ASKED=1
    SAW_HEARD=1
    SAW_ANSWERED=1
    SAW_POSTED_AGAIN=1
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

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "a form never posted names the guest" "yes" \
  "$(blames "the guest" 0 SAW_POSTED=0)"
expect "a reload that never came names the element's loading" "yes" \
  "$(blames "domicile-loading-change" 0 SAW_RELOADING=0)"

echo
echo "the positive run: the shell says yes"
expect "a second post after the shell's yes is the pass" "pass" "$(verdict 0)"
expect "a browser that never asked blames ShowRepostFormWarningDialog" "yes" \
  "$(blames "ShowRepostFormWarningDialog" 0 SAW_ASKED=0)"
expect "a prompt never heard blames the element" "yes" \
  "$(blames "PromptRequested" 0 SAW_HEARD=0)"
expect "an answer that never arrived is a failure" "fail" \
  "$(verdict 0 SAW_ANSWERED=0)"
expect "a yes that sent nothing blames ContinuePendingReload" "yes" \
  "$(blames "ContinuePendingReload" 0 SAW_POSTED_AGAIN=0)"

echo
echo "the control run: the shell says no"
expect "one post only is the pass" "pass" "$(verdict 1 SAW_POSTED_AGAIN=0)"
expect "a second post is the control's failure" "yes" \
  "$(blames "CancelPendingReload" 1)"
expect "a prompt never asked fails the control too" "fail" \
  "$(verdict 1 SAW_ASKED=0 SAW_POSTED_AGAIN=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the resend form guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
