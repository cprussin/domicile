#!/usr/bin/env bash
# Tests the verdict block in `guard-webview-activate.sh`, read out of the real
# script.
#
# - In the control run, a request reaching the shell is a failure.
# - A missing request blames `ActivateContents` only when the engine's own log
#   line is missing too; otherwise it blames the element.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-activate.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

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

# Every reading passes the positive run; each case overrides some.
judged() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    BROUGHT=1
    SAW_ASKED=1
    SAW_REQUEST=1
    NEGATIVE="$1"
    shift
    for override in "$@"; do
      eval "$override"
    done
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail: $FAILURE"
    else
      echo "neither"
    fi
  )
}

verdict() { # the args judged takes
  local said
  said="$(judged "$@")"
  echo "${said%%:*}"
}

blames() { # $1 word, then the args judged takes
  local word="$1"
  shift
  case "$(judged "$@")" in
  "fail: "*"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "and in the control" "fail" "$(verdict 1 SAW_SHELL=0 SAW_REQUEST=0)"
expect "it blames the harness" "yes" "$(blames "harness" 0 SAW_SHELL=0)"
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "and in the control" "fail" "$(verdict 1 SAW_PAGE=0 SAW_REQUEST=0)"
expect "it names the guest" "yes" "$(blames "guest" 0 SAW_PAGE=0)"
expect "a front the debugging port refused is a failure" "fail" \
  "$(verdict 0 BROUGHT=0)"
expect "and in the control" "fail" "$(verdict 1 BROUGHT=0 SAW_REQUEST=0)"
expect "it blames the harness" "yes" "$(blames "harness" 0 BROUGHT=0)"

echo
echo "the positive run — the window's page brought to the front"
expect "the request reaching the shell is the pass" "pass" "$(verdict 0)"
expect "no request at all is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_REQUEST=0)"
expect "with no engine line, it blames WebViewGuest" "yes" \
  "$(blames "ActivateContents" 0 SAW_ASKED=0 SAW_REQUEST=0)"
expect "the engine asking and the shell not hearing is a failure" "fail" \
  "$(verdict 0 SAW_REQUEST=0)"
expect "and it blames the element, not WebViewGuest" "yes" \
  "$(blames "element" 0 SAW_REQUEST=0)"
expect "and not ActivateContents" "no" \
  "$(blames "ActivateContents" 0 SAW_REQUEST=0)"

echo
echo "the control — the shell's own page brought to the front"
expect "nothing reaching the shell is the pass" "pass" \
  "$(verdict 1 SAW_ASKED=0 SAW_REQUEST=0)"
expect "a request reaching it anyway is a failure" "fail" "$(verdict 1)"
expect "and it says the claim measures nothing" "yes" \
  "$(blames "says nothing" 1)"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED case(s) failed"
  exit 1
fi
echo "every case passed"
