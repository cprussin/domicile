#!/usr/bin/env bash
# Tests which end the image-effect guard blames and which results it passes.
#
# Runs the verdict block from `guard-shader-image.sh` itself, not a copy. Key
# cases: the image's color passes, a window drawn without it fails naming the
# inputs' path, and the control fails if the image's color turns up with no
# filter.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shader-image.sh"
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

# MEASURED is "<mode> <registered> <rejected> <drawn> <stamped> <plain>".
echo "the claim — the effect samples the shell's image"
expect "the image's color is the pass" "pass" "$(verdict "claim 1 1 1 1 0")"
expect "and the window's own color beside it does not matter" "pass" \
  "$(verdict "claim 1 1 1 1 1")"
expect "a window without the image is a failure" "fail" \
  "$(verdict "claim 1 1 1 0 1")"
expect "and blames the inputs' path" "yes" \
  "$(says "claim 1 1 1 0 1" "ResolveShaderEffects")"
expect "nothing on the page is a failure" "fail" "$(verdict "claim 1 1 1 0 0")"
expect "an effect that never registered is a failure" "fail" \
  "$(verdict "claim 0 1 1 1 0")"
expect "an unsampled image that did not reject is a failure" "fail" \
  "$(verdict "claim 1 0 1 1 0")"
expect "no window is a failure" "fail" "$(verdict "claim 1 1 0 0 0")"

echo "the control — no filter"
expect "the window's own color and no image is the pass" "pass" \
  "$(verdict "plain 1 1 1 0 1")"
expect "the image's color with no filter is a failure" "fail" \
  "$(verdict "plain 1 1 1 1 1")"
expect "a control whose window never drew is a failure" "fail" \
  "$(verdict "plain 1 1 1 0 0")"

echo "anything else"
expect "a mode the guard does not know is a failure" "fail" \
  "$(verdict "other 1 1 1 1 1")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
