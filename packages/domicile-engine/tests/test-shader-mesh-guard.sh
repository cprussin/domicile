#!/usr/bin/env bash
# Tests which end the mesh-effect guard blames and which results it passes.
#
# Runs the verdict block and the width readings from `guard-shader-mesh.sh`
# itself, not copies. Key cases: the swapped color at half the width passes,
# no swapped color fails naming the mesh's path, and the control fails if the
# swapped color turns up with no filter.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shader-mesh.sh"
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

# MEASURED is "<mode> <registered> <rejected> <drawn> <swapped> <shrunk>".
echo "the claim — the <app> is drawn through the mesh"
expect "the swapped color at half the width is the pass" "pass" \
  "$(verdict "claim 1 1 1 1 1")"
expect "the swapped color at the whole width is a failure" "fail" \
  "$(verdict "claim 1 1 1 1 0")"
expect "and blames the vertex program's placing" "yes" \
  "$(says "claim 1 1 1 1 0" "DrawMeshEffect")"
expect "no swapped color is a failure" "fail" "$(verdict "claim 1 1 1 0 -")"
expect "and names the renderer's mesh path" "yes" \
  "$(says "claim 1 1 1 0 -" "FindMeshEffect")"
expect "an effect that never registered is a failure" "fail" \
  "$(verdict "claim 0 1 1 1 1")"
expect "a broken vertex program that did not reject is a failure" "fail" \
  "$(verdict "claim 1 0 1 1 1")"
expect "no window is a failure" "fail" "$(verdict "claim 1 1 0 0 -")"

echo "the control — no filter"
expect "the whole width in its own color is the pass" "pass" \
  "$(verdict "plain 1 1 1 0 0")"
expect "the swapped color with no filter is a failure" "fail" \
  "$(verdict "plain 1 1 1 1 0")"
expect "a window short of its <app> is a failure" "fail" \
  "$(verdict "plain 1 1 1 0 1")"

echo "anything else"
expect "a mode the guard does not know is a failure" "fail" \
  "$(verdict "other 1 1 1 1 1")"

echo "the swap of the window's color"
COLOR=5F9EA0
expect "red and blue change places" "A09E5F" \
  "$(eval "$(grep -E '^SWAPPED=' "$GUARD")"; echo "$SWAPPED")"

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
