#!/usr/bin/env bash
# Tests which end the compositor-restart guard blames and which results it
# passes.
#
# Runs the verdict block from `guard-app-survives-compositor-restart.sh`
# itself, not a copy. Key cases: the new color on the kept `<app>` passes, a
# blank `<app>` fails naming the re-embed, and the control fails if the new
# color turns up when nothing drew it.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-app-survives-compositor-restart.sh"
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

# MEASURED is "<mode> <first> <joined> <closed> <ended> <replaced> <heard>
# <looked> <fresh>".
echo "the claim — the next compositor's client draws a new color"
expect "the new color on the kept <app> is the pass" "pass" \
  "$(verdict "switch 1 1 1 1 1 1 1 1")"
expect "a blank <app> is a failure" "fail" \
  "$(verdict "switch 1 1 1 1 1 1 1 0")"
expect "and blames the re-embed" "yes" \
  "$(says "switch 1 1 1 1 1 1 1 0" "kProducerGone")"
expect "no first client is a failure" "fail" \
  "$(verdict "switch 0 1 1 1 1 1 1 1")"
expect "a channel that never dialed again is a failure" "fail" \
  "$(verdict "switch 1 0 1 1 1 1 1 1")"
expect "and blames the hang-up" "yes" \
  "$(says "switch 1 0 1 1 1 1 1 1" "OnHungUp")"
expect "a window never closed is a failure" "fail" \
  "$(verdict "switch 1 1 0 1 1 1 1 1")"
expect "a watch that did not end is a failure" "fail" \
  "$(verdict "switch 1 1 1 0 1 1 1 1")"
expect "and names compositor_gone" "yes" \
  "$(says "switch 1 1 1 0 1 1 1 1" "compositor_gone")"
expect "no compositorreplaced is a failure" "fail" \
  "$(verdict "switch 1 1 1 1 0 1 1 1")"
expect "a watch that heard nothing again is a failure" "fail" \
  "$(verdict "switch 1 1 1 1 1 0 1 1")"
expect "a probe that stopped looking is a failure" "fail" \
  "$(verdict "switch 1 1 1 1 1 1 0 0")"
expect "and says nothing was looked for" "yes" \
  "$(says "switch 1 1 1 1 1 1 0 0" "not looked for")"

echo
echo "the control — the next client draws the first color"
expect "no new color is the control's pass" "pass" \
  "$(verdict "still 1 1 1 1 1 1 1 0")"
expect "a new color nobody drew is the control's failure" "fail" \
  "$(verdict "still 1 1 1 1 1 1 1 1")"
expect "and says the guard matches something else" "yes" \
  "$(says "still 1 1 1 1 1 1 1 1" "something other")"
expect "a probe that stopped looking cannot pass the control" "fail" \
  "$(verdict "still 1 1 1 1 1 1 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" \
  "$(verdict "elephant 1 1 1 1 1 1 1 1")"

echo
echo "the touch — heard by the watch the shell holds now"
READINGS="$(awk '/^# The watch the shell holds now/,/^# The end of the watch readings/' "$GUARD")"
[ -n "$READINGS" ] || {
  echo "no watch readings in $GUARD — their markers moved. Fix this test with it." >&2
  exit 1
}
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
TOUCHED=/tmp/watched/touched
heard() { # the engine log's lines, one per argument
  printf '%s\n' "$@" >"$LOG"
  (
    eval "$READINGS"
    if heard_the_touch "$LOG" "$TOUCHED"; then echo yes; else echo no; fi
  )
}
event() { # $1 id
  echo "\"GUARD system {\"type\":\"system_event\",\"id\":$1,\"event\":{\"kind\":\"changed\",\"path\":\"$TOUCHED\"}}\""
}
expect "the one watch sent again hears the touch" "yes" \
  "$(heard "GUARD rewatch id=2" "$(event 2)")"
# CI run 38822858173: the engine reached the dying compositor once more, so a
# second hang-up failed id 2 and the shell watched again as id 3.
expect "a watch sent again twice hears it under its last id" "yes" \
  "$(heard "GUARD rewatch id=2" "GUARD rewatch id=3" "$(event 3)")"
expect "a touch heard by an older watch is not the one held now" "no" \
  "$(heard "GUARD rewatch id=2" "GUARD rewatch id=3" "$(event 2)")"
expect "a watch never sent again hears nothing" "no" \
  "$(heard "$(event 1)")"
ELSEWHERE="$(event 2)"
expect "a change to another path is not the touch" "no" \
  "$(heard "GUARD rewatch id=2" "${ELSEWHERE/touched/other}")"

if [ "$FAILED" -eq 0 ]; then
  echo "the compositor-restart guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
