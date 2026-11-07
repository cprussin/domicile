#!/usr/bin/env bash
# Tests the verdict of `guard-webview-file-access.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a prompt that never reached the shell only means
# something once the page opened the file. Key cases:
#
#   - A browser that never asked blames the override (SetDomicilePrompts).
#   - A yes that never wrote the file fails: the grant was lost on the way
#     back to the page.
#   - In the control, a written file fails: the shell said no.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-file-access.sh"
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
    SAW_OPENED=1
    SAW_ASKED=1
    SAW_HEARD=1
    SAW_ANSWERED=1
    SAW_SETTLED=1
    SAW_REFUSED=0
    WRITTEN=1
    KEPT=0
    NAME=guard-edit.txt
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

# The control's shell says no: the page is refused and the file is kept.
control() {
  verdict 1 SAW_REFUSED=1 WRITTEN=0 KEPT=1 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press at all blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a file never opened names the file picker" "yes" \
  "$(blames "file picker" 0 SAW_OPENED=0)"

echo
echo "the positive run — the shell says yes"
expect "a prompt asked, heard, answered and written is the pass" "pass" \
  "$(verdict 0)"
expect "a browser that never asked blames the override" "yes" \
  "$(blames "SetDomicilePrompts" 0 SAW_ASKED=0)"
expect "a shell that never heard blames PromptRequested" "yes" \
  "$(blames "PromptRequested" 0 SAW_HEARD=0)"
expect "an answer that threw is a failure" "fail" \
  "$(verdict 0 SAW_ANSWERED=0)"
expect "an answer the browser never got blames the reply" "yes" \
  "$(blames "AskPrompt" 0 SAW_SETTLED=0)"
expect "a yes that wrote nothing is a failure" "fail" \
  "$(verdict 0 WRITTEN=0)"

echo
echo "the control run — the shell says no"
expect "a refused page and a kept file is the pass" "pass" "$(control)"
expect "a written file is the control's failure" "fail" \
  "$(control KEPT=0 WRITTEN=1)"
expect "a page never told no is a failure" "fail" \
  "$(control SAW_REFUSED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the file access guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
