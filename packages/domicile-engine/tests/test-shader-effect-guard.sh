#!/usr/bin/env bash
# Tests which end the shader-effect guard blames and which results it passes.
#
# Runs the verdict block from `guard-shader-effect.sh` itself, not a copy. Key
# cases: the swapped color passes, an unshaded window fails naming the
# filter's path, and the control fails if the swapped color turns up with no
# filter.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shader-effect.sh"
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

# MEASURED is "<mode> <registered> <rejected> <drawn> <swapped> <plain>".
echo "the claim — the <app> is drawn through the effect"
expect "the swapped color is the pass" "pass" "$(verdict "shade 1 1 1 1 0")"
expect "and the window's own color beside it does not matter" "pass" \
  "$(verdict "shade 1 1 1 1 1")"
expect "an unshaded window is a failure" "fail" "$(verdict "shade 1 1 1 0 1")"
expect "and blames the filter's path" "yes" \
  "$(says "shade 1 1 1 0 1" "ResolveShaderEffects")"
expect "nothing on the page is a failure" "fail" "$(verdict "shade 1 1 1 0 0")"
expect "an effect that never registered is a failure" "fail" \
  "$(verdict "shade 0 1 1 1 0")"
expect "and names the shell-only binder" "yes" \
  "$(says "shade 0 1 1 1 0" "BindDomicileShaderEffects")"
expect "broken SkSL that did not reject is a failure" "fail" \
  "$(verdict "shade 1 0 1 1 0")"
expect "even with the swapped color on the page" "fail" \
  "$(verdict "shade 1 0 1 1 1")"
expect "no window is a failure" "fail" "$(verdict "shade 1 1 0 0 0")"

echo "the control — no filter"
expect "the window's own color and no swap is the pass" "pass" \
  "$(verdict "plain 1 1 1 0 1")"
expect "the swapped color with no filter is a failure" "fail" \
  "$(verdict "plain 1 1 1 1 1")"
expect "and says the guard matched something else" "yes" \
  "$(says "plain 1 1 1 1 1" "something other than")"
expect "a control whose window never drew is a failure" "fail" \
  "$(verdict "plain 1 1 1 0 0")"

echo "anything else"
expect "a mode the guard does not know is a failure" "fail" \
  "$(verdict "other 1 1 1 1 1")"

echo "the swap of the window's color"
COLOR=2E8B57
expect "red and blue change places" "578B2E" \
  "$(eval "$(grep -E '^SWAPPED=' "$GUARD")"; echo "$SWAPPED")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
