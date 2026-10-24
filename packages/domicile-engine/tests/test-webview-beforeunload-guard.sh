#!/usr/bin/env bash
# Tests the verdict of `guard-webview-beforeunload.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a dialog that never reached the shell only means
# something once the page armed its handler and the shell asked to close. Key
# cases:
#
#   - A close that never asked the page blames the close path: the window was
#     destroyed without running `beforeunload`.
#   - A page that asked and a shell that never heard blames the dialog manager.
#   - A window gone after the shell's Cancel fails: Cancel must keep the page.
#   - In the control, any dialog report fails, and so does a window that never
#     closed: a page with no handler closes at once.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-beforeunload.sh"
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
    SAW_PRESS=1
    SAW_ARMED=1
    SAW_CLOSING=1
    SAW_ASKED_PAGE=1
    SAW_ASKED_SHELL=1
    SAW_HEARD=1
    SAW_STAYED=1
    SAW_CLOSED=1
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

# The control presses the plain half, so the page has no handler and closes
# without a dialog.
control() {
  verdict 1 SAW_ARMED=0 SAW_ASKED_PAGE=0 SAW_ASKED_SHELL=0 SAW_HEARD=0 \
    SAW_STAYED=0 SAW_ANY=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "no press in the page is a failure" "fail" "$(verdict 0 SAW_PRESS=0)"
expect "no press in the page is the control's failure too" "fail" \
  "$(control SAW_PRESS=0)"
expect "a shell that never asked to close is a failure" "fail" \
  "$(verdict 0 SAW_CLOSING=0)"
expect "a shell that never asked to close is the control's failure too" \
  "fail" "$(control SAW_CLOSING=0)"

echo
echo "the positive run — the arm button"
expect "a Cancel that kept the page and a Leave that closed it is the pass" \
  "pass" "$(verdict 0)"
expect "a page that never armed is a failure" "fail" "$(verdict 0 SAW_ARMED=0)"
expect "a close that never asked the page blames the close path" "yes" \
  "$(blames "DispatchBeforeUnload" 0 SAW_ASKED_PAGE=0)"
expect "a page that asked and a browser that never asked the shell blames the dialog manager" \
  "yes" "$(blames "RunBeforeUnloadDialog" 0 SAW_ASKED_SHELL=0)"
expect "a shell that never heard blames DialogRequested" "yes" \
  "$(blames "DialogRequested" 0 SAW_HEARD=0)"
expect "a window gone after Cancel is a failure" "fail" \
  "$(verdict 0 SAW_STAYED=0)"
expect "a window still open after Leave blames BeforeUnloadFired" "yes" \
  "$(blames "BeforeUnloadFired" 0 SAW_CLOSED=0)"

echo
echo "the control run — a press on the half that arms nothing"
expect "closing at once with no dialog is the pass" "pass" "$(control)"
expect "any dialog report is the control's failure" "fail" \
  "$(control SAW_ANY=1)"
expect "a window that never closed is the control's failure" "fail" \
  "$(control SAW_CLOSED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the beforeunload guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
