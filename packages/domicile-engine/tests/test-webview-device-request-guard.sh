#!/usr/bin/env bash
# Tests the verdict of `guard-webview-device-request.sh`: which readings pass
# and which component a failure blames.
#
# The checks are ordered: a request that never reached the shell only means
# something once a press reached the page. Key cases:
#
#   - A browser that never asked blames patch 0110's override: the page's
#     request went to Chrome's bubble.
#   - A page that never settled fails: it would wait forever for a device.
#   - In the control, any device report fails: the press was on the part of
#     the page that asks for nothing.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-device-request.sh"
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
    SAW_REFUSED=0
    SAW_ASKED=1
    SAW_REQUEST=1
    SAW_ANSWERED=1
    SAW_DECIDED=1
    SAW_SETTLED=1
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

# The control presses the plain half, so it hears no request.
control() {
  verdict 1 SAW_ASKED=0 SAW_REQUEST=0 SAW_ANSWERED=0 SAW_DECIDED=0 \
    SAW_SETTLED=0 SAW_ANY=0 "$@"
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

echo
echo "the positive run — the connect button"
expect "a request answered and settled is the pass" "pass" "$(verdict 0)"
expect "a refused request names Blink's refusal" "yes" \
  "$(blames "refused" 0 SAW_REFUSED=1)"
expect "a browser that never asked blames the override" "yes" \
  "$(blames "patch 0110" 0 SAW_ASKED=0)"
expect "a shell that never heard blames DeviceRequested" "yes" \
  "$(blames "DeviceRequested" 0 SAW_REQUEST=0)"
expect "an answer that threw is a failure" "fail" \
  "$(verdict 0 SAW_ANSWERED=0)"
expect "an answer the browser dropped blames ShellDeviceChooser" "yes" \
  "$(blames "ShellDeviceChooser" 0 SAW_DECIDED=0)"
expect "a page left waiting is a failure" "fail" "$(verdict 0 SAW_SETTLED=0)"

echo
echo "the control run — a press on the half that asks for nothing"
expect "hearing nothing is the pass" "pass" "$(control)"
expect "any device report is the control's failure" "fail" \
  "$(control SAW_ANY=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the device request guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
