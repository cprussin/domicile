#!/usr/bin/env bash
# Tests the verdict logic of `guard-webview-upload.sh`: which layer a failure
# blames, and which results count as a pass.
#
# The verdict block is extracted from the real script, not copied, so this test
# fails if the block's markers move. The checks run in order, and a wrong order
# can blame the wrong layer without any engine failing.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-upload.sh"
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

# Starts from a passing positive run; each case overrides one reading.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  SAW_SHELL=1
  SAW_PAGE=1
  SAW_CHROME=1
  SAW_GUEST=1
  SAW_BROWSER=1
  SAW_ASKED=1
  SAW_ANSWERED=1
  SAW_PICKED=1
  SAW_ANY_PICK=1
  SAW_NOTHING=0
  NEGATIVE="$1"
  shift
  for override in "$@"; do
    eval "$override"
  done
  eval "$BLOCK"
}

verdict() {
  (
    run_block "$@"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$( (run_block "$@"; echo "$FAILURE"))" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# Control run readings: the shell canceled, so no file and a cancel event.
CONTROL="SAW_PICKED=0 SAW_ANY_PICK=0 SAW_NOTHING=1"

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
# shellcheck disable=SC2086
expect "and in the control, where no file is what a broken harness looks like too" \
  "fail" "$(verdict 1 $CONTROL SAW_SHELL=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press that missed the guest is a failure" "fail" \
  "$(verdict 0 SAW_GUEST=0)"

echo
echo "which process the question stopped in"
expect "a browser never asked says so" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_BROWSER=0 SAW_ASKED=0)"
expect "a browser asked and a shell not told says so" "yes" \
  "$(blames "SHELL WAS NOT" 0 SAW_ASKED=0)"
expect "an answer that threw blames this guard's page" "yes" \
  "$(blames "threw" 0 SAW_ANSWERED=0)"

echo
echo "the positive run"
expect "the file, read, is the pass" "pass" "$(verdict 0)"
expect "another file is a failure" "fail" "$(verdict 0 SAW_PICKED=0)"
expect "another file says so" "yes" "$(blames "WRONG FILE" 0 SAW_PICKED=0)"
expect "a cancel instead of the file is a failure" "fail" \
  "$(verdict 0 SAW_PICKED=0 SAW_ANY_PICK=0 SAW_NOTHING=1)"
expect "a cancel instead of the file says the answer became one" "yes" \
  "$(blames "BECAME A CANCEL" 0 SAW_PICKED=0 SAW_ANY_PICK=0 SAW_NOTHING=1)"
expect "silence is a failure" "fail" \
  "$(verdict 0 SAW_PICKED=0 SAW_ANY_PICK=0)"

echo
echo "the control run — a shell that cancels"
# shellcheck disable=SC2086
expect "no file and a cancel heard is the pass" "pass" "$(verdict 1 $CONTROL)"
# shellcheck disable=SC2086
expect "a file after a cancel is the failure" "fail" \
  "$(verdict 1 $CONTROL SAW_ANY_PICK=1)"
# shellcheck disable=SC2086
expect "a cancel the page never heard is a failure" "fail" \
  "$(verdict 1 $CONTROL SAW_NOTHING=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the upload guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
