#!/usr/bin/env bash
# Tests which end the load-shell guard blames and which results it passes.
#
# Runs the verdict block from `guard-webview-survives-load-shell.sh` itself, not
# a copy, like the other guards' tests. Key cases: one token in the claim
# passes, and one token in the control fails. A reload that reloaded nothing
# would read one token in both, so only the control proves the claim.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-survives-load-shell.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
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

verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<mode> <answered> <loads> <tokens> <shown> <ticked>".
echo "the claim — a browser window across a shell load"
expect "one page, shown again and still running, is the pass" "pass" \
  "$(verdict "window 1 2 1 1 1")"
expect "a page loaded again is a failure" "fail" "$(verdict "window 1 2 2 1 1")"
expect "and says so" "yes" "$(says "window 1 2 2 1 1" "LOADED AGAIN")"
expect "a page the new shell does not show is a failure" "fail" \
  "$(verdict "window 1 2 1 0 1")"
expect "and blames the attach" "yes" "$(says "window 1 2 1 0 1" "AttachToElement")"
expect "a page that stopped is a failure" "fail" "$(verdict "window 1 2 1 1 0")"
expect "no answer from the engine is a failure" "fail" \
  "$(verdict "window 0 1 1 0 0")"
expect "and blames the command socket" "yes" \
  "$(says "window 0 1 1 0 0" "command socket")"
expect "a shell not loaded again is a failure" "fail" \
  "$(verdict "window 1 1 1 1 1")"
expect "a page that never loaded is a failure" "fail" \
  "$(verdict "window 1 2 0 0 0")"

echo
echo "the control — the shell's own <webview src>"
expect "a page loaded again is the control's pass" "pass" \
  "$(verdict "own 1 2 2 1 0")"
expect "a page that was not loaded again is the control's failure" "fail" \
  "$(verdict "own 1 2 1 1 1")"
expect "and says the claim's token says nothing" "yes" \
  "$(says "own 1 2 1 1 1" "says nothing")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 1 2 1 1 1")"

if [ "$FAILED" -eq 0 ]; then
  echo "the load-shell guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
