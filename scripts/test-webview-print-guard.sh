#!/usr/bin/env bash
# Tests the verdict of `guard-webview-print.sh`: which readings pass and which
# component a failure blames.
#
# The checks are ordered: a print the page never finished only means something
# once it started. Key cases:
#
#   - A print() the browser never ran blames the element or WebViewGuest.
#   - A print that never reached the page blames AttachPrinting.
#   - A window.print() that never finished blames Print Preview being on.
#   - A crash fails anywhere, the control included.
#   - In the control, any print the page saw fails.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-print.sh"
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
    SAW_CRASH=0
    SAW_ASKED=1
    SAW_PRINTED=1
    SAW_BEFORE=1
    SAW_AFTER=1
    SAW_OWN_BEFORE=1
    SAW_OWN_AFTER=1
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

# The control never calls print(), so nothing prints.
control() {
  verdict 1 SAW_ASKED=0 SAW_PRINTED=0 SAW_BEFORE=0 SAW_AFTER=0 \
    SAW_OWN_BEFORE=0 SAW_OWN_AFTER=0 SAW_ANY=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "an empty window is the control's failure too" "fail" \
  "$(control SAW_PAGE=0)"
expect "a crash is a failure" "fail" "$(verdict 0 SAW_CRASH=1)"
expect "a crash is the control's failure too" "fail" "$(control SAW_CRASH=1)"

echo
echo "the positive run — print(), then the page's window.print()"
expect "two prints that started and finished is the pass" "pass" \
  "$(verdict 0)"
expect "a shell that never asked is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0)"
expect "a print() the browser never ran blames WebViewGuest" "yes" \
  "$(blames "WebViewGuest::Print" 0 SAW_PRINTED=0)"
expect "a print the page never started blames AttachPrinting" "yes" \
  "$(blames "AttachPrinting" 0 SAW_BEFORE=0)"
expect "a print the page never finished blames the dialog" "yes" \
  "$(blames "dialog" 0 SAW_AFTER=0)"
expect "a window.print() that never started is a failure" "fail" \
  "$(verdict 0 SAW_OWN_BEFORE=0)"
expect "a window.print() that never finished blames Print Preview" "yes" \
  "$(blames "PrintWithTheSystemDialog" 0 SAW_OWN_AFTER=0)"

echo
echo "the control run — no print()"
expect "a page that never printed is the pass" "pass" "$(control)"
expect "any print the page saw is the control's failure" "fail" \
  "$(control SAW_ANY=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the print guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
