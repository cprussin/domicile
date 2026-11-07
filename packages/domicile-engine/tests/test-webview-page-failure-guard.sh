#!/usr/bin/env bash
# Tests the verdict of `guard-webview-page-failure.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a report the shell never heard only means something
# once the browser reported a failure. Key cases:
#
#   - A browser that never reported blames WebViewGuest's DidFinishNavigation.
#   - An HTTP error heard without its status blames the response headers.
#   - A failure never cleared fails: the shell would cover a loaded page.
#   - In the control, any report fails: the page loads.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-page-failure.sh"
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
    SAW_ASKED=1
    SAW_LOADED=1
    SAW_REPORTED=1
    SAW_HTTP=1
    SAW_NETWORK=1
    SAW_CLEARED=1
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

# The control loads a page that works, so nothing is reported.
control() {
  verdict 1 SAW_REPORTED=0 SAW_HTTP=0 SAW_NETWORK=0 SAW_CLEARED=0 SAW_ANY=0 \
    "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "a server never asked names the guest" "yes" \
  "$(blames "the guest" 0 SAW_ASKED=0)"
expect "an empty window in the control names the guest" "yes" \
  "$(blames "the guest" 1 SAW_LOADED=0 SAW_ANY=0)"

echo
echo "the positive run: two failures, then a page that loads"
expect "each failure heard and cleared is the pass" "pass" "$(verdict 0)"
expect "a browser that never reported blames DidFinishNavigation" "yes" \
  "$(blames "DidFinishNavigation" 0 SAW_REPORTED=0)"
expect "an HTTP error never heard as such blames the headers" "yes" \
  "$(blames "response headers" 0 SAW_HTTP=0)"
expect "a network error never heard is a failure" "fail" \
  "$(verdict 0 SAW_NETWORK=0)"
expect "a failure never cleared is a failure" "fail" \
  "$(verdict 0 SAW_CLEARED=0)"

echo
echo "the control run: a page that loads"
expect "hearing nothing is the pass" "pass" "$(control)"
expect "any report is the control's failure" "fail" "$(control SAW_ANY=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the page failure guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
