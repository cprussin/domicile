#!/usr/bin/env bash
# Which end the count matches guard blames, and which runs it calls a pass.
#
# The unit is the verdict block in `guard-webview-count-matches.sh`, run out of
# the real script rather than copied, so a rewrite that moves it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-count-matches.sh"
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

# A positive run in which everything is true; each case changes one reading.
# Prints the verdict, then the failing sentence.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_BAD_SELECTOR=1
    COUNTED=1
    VIEWS=0
    WANT=1
    NEGATIVE="$1"
    [ "$NEGATIVE" = "1" ] && COUNTED=0 && WANT=0
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

verdict() {
  run_block "$@" | head -1
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(run_block "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as counting"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "and blames the harness" "yes" "$(blames "harness" 0 SAW_SHELL=0)"
expect "a bad selector that did not throw is a failure" "fail" \
  "$(verdict 0 SAW_BAD_SELECTOR=0)"
expect "no count is a failure" "fail" "$(verdict 0 COUNTED=)"
expect "and names CountMatches" "yes" "$(blames "CountMatches" 0 COUNTED=)"

echo
echo "the positive run"
expect "the page's one script is the pass" "pass" "$(verdict 0)"
expect "counting the shell's webview is a failure" "fail" "$(verdict 0 VIEWS=1)"
expect "and blames the shell's document" "yes" \
  "$(blames "shell's document" 0 VIEWS=1)"
expect "a wrong count is a failure" "fail" "$(verdict 0 COUNTED=2)"

echo
echo "the control run -- a selector the page has none of"
expect "0 is the pass" "pass" "$(verdict 1)"
expect "the positive run's 1 is the control's failure" "fail" \
  "$(verdict 1 COUNTED=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the count matches guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
