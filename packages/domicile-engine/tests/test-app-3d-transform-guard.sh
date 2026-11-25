#!/usr/bin/env bash
# Tests which end the 3D-transform guard blames and which results it passes.
#
# Runs the verdict block and the width readings from
# `guard-app-3d-transform.sh` itself, not copies. Key cases: a window at half
# the `<app>`'s width passes, one at its whole width fails as drawn flat, and
# the control fails if its window is narrower with no transform.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-app-3d-transform.sh"
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

# MEASURED is "<mode> <drawn> <found> <shrunk>".
echo "the claim — the <app> is drawn through the 3D transform"
expect "a window at half the width is the pass" "pass" "$(verdict "claim 1 1 1")"
expect "one at the whole width is a failure" "fail" "$(verdict "claim 1 1 0")"
expect "and says it drew flat" "yes" "$(says "claim 1 1 0" "DREW FLAT")"
expect "a box between the two is a failure" "fail" "$(verdict "claim 1 1 -")"
expect "no window color is a failure" "fail" "$(verdict "claim 1 0 -")"
expect "no window is a failure" "fail" "$(verdict "claim 0 0 -")"

echo "the control — no transform"
expect "the whole width is the pass" "pass" "$(verdict "plain 1 1 0")"
expect "a narrower window with no transform is a failure" "fail" \
  "$(verdict "plain 1 1 1")"
expect "and says the guard matched something else" "yes" \
  "$(says "plain 1 1 1" "something other than")"

echo "anything else"
expect "a mode the guard does not know is a failure" "fail" \
  "$(verdict "other 1 1 1")"

echo "the box's width against the <app>'s"
ENGINE_LOG="$(mktemp)"
COMP_LOG="$(mktemp)"
trap 'rm -f "$ENGINE_LOG" "$COMP_LOG"' EXIT
eval "$(awk '/^found_width\(\) \{$/,/^}$/' "$GUARD")"
eval "$(awk '/^app_width\(\) \{$/,/^}$/' "$GUARD")"
eval "$(awk '/^shrunk\(\) \{$/,/^}$/' "$GUARD")"
echo "GUARD drawn app=kitty width=640 filter=none" >"$ENGINE_LOG"
echo "engine found #FF123456 over (0,0) 320x240 of the browser's 1024x768 window" >"$COMP_LOG"
expect "half the width is shrunk" "1" "$(shrunk 123456)"
echo "engine found #FF123456 over (0,0) 640x480 of the browser's 1024x768 window" >>"$COMP_LOG"
expect "the last box counts, and the whole width is not" "0" "$(shrunk 123456)"
echo "engine found #FF123456 over (0,0) 540x480 of the browser's 1024x768 window" >>"$COMP_LOG"
expect "between the two is neither" "-" "$(shrunk 123456)"
expect "a color never found is neither" "-" "$(shrunk 654321)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
