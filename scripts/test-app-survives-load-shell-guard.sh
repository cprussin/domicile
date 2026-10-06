#!/usr/bin/env bash
# Tests which end the `<app>` load-shell guard blames and which results it
# passes.
#
# Runs the verdict block from `guard-app-survives-load-shell.sh` itself, not a
# copy. Key cases: a fresh frame at the new box size passes, a frozen app fails
# naming the reused surface, and the control fails if the new color turns up
# when nothing drew it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-app-survives-load-shell.sh"
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

# MEASURED is "<mode> <answered> <loads> <before> <readopted> <looked> <fresh>
# <grown>".
echo "the claim — the client changes color after the reload"
expect "a fresh frame at the new box size is the pass" "pass" \
  "$(verdict "switch 1 2 1 1 1 1 1")"
expect "no fresh frame is a failure" "fail" "$(verdict "switch 1 2 1 1 1 0 0")"
expect "and blames the reused surface" "yes" \
  "$(says "switch 1 2 1 1 1 0 0" "LocalSurfaceId")"
expect "a fresh frame at the old size is a failure" "fail" \
  "$(verdict "switch 1 2 1 1 1 1 0")"
expect "and says so" "yes" "$(says "switch 1 2 1 1 1 1 0" "old box")"
expect "no answer from the engine is a failure" "fail" \
  "$(verdict "switch 0 1 1 0 1 0 0")"
expect "and blames the command socket" "yes" \
  "$(says "switch 0 1 1 0 1 0 0" "command socket")"
expect "a shell not loaded again is a failure" "fail" \
  "$(verdict "switch 1 1 1 1 1 1 1")"
expect "a client never on the first page is a failure" "fail" \
  "$(verdict "switch 1 2 0 1 1 1 1")"
expect "a second shell that never embedded is a failure" "fail" \
  "$(verdict "switch 1 2 1 0 1 1 1")"
expect "a probe that stopped looking is a failure" "fail" \
  "$(verdict "switch 1 2 1 1 0 0 0")"
expect "and says nothing was looked for" "yes" \
  "$(says "switch 1 2 1 1 0 0 0" "not looked for")"

echo
echo "the control — the client keeps its color"
expect "no new color is the control's pass" "pass" \
  "$(verdict "still 1 2 1 1 1 0 0")"
expect "a new color nobody drew is the control's failure" "fail" \
  "$(verdict "still 1 2 1 1 1 1 1")"
expect "and says the guard matches something else" "yes" \
  "$(says "still 1 2 1 1 1 1 1" "something other")"
expect "a probe that stopped looking cannot pass the control" "fail" \
  "$(verdict "still 1 2 1 1 0 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" \
  "$(verdict "elephant 1 2 1 1 1 1 1")"

if [ "$FAILED" -eq 0 ]; then
  echo "the app load-shell guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
