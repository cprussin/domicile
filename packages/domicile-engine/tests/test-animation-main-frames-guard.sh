#!/usr/bin/env bash
# Tests which results `guard-animation-main-frames.sh` passes.
#
# Runs the guard's own verdict block, not a copy. Key cases:
#
#   - The claim passes on a few callbacks and fails on one a frame, naming
#     the testing config.
#   - The control passes only on many, so the claim's few are the build's
#     doing.
#   - A shell that never ran, or a slide that never ended, fails.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-animation-main-frames.sh"
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
    MAX_CALLBACKS=10
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
    MAX_CALLBACKS=10
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<mode> <shell> <callbacks>".
echo "the claim — the engine as built"
expect "a few callbacks is the pass" "pass" "$(verdict "claim 1 5")"
expect "the limit itself passes" "pass" "$(verdict "claim 1 10")"
expect "one a frame is a failure" "fail" "$(verdict "claim 1 61")"
expect "and names the testing config" "yes" \
  "$(says "claim 1 61" "disable_fieldtrial_testing_config")"
expect "a slide that never ended is a failure" "fail" "$(verdict "claim 1 none")"
expect "a shell that never ran is a failure" "fail" "$(verdict "claim 0 none")"

echo
echo "the control — main frames forced"
expect "many callbacks is the control's pass" "pass" "$(verdict "control 1 61")"
expect "a few is the control's failure" "fail" "$(verdict "control 1 5")"
expect "and says the claim then means nothing" "yes" \
  "$(says "control 1 5" "says nothing")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the animation main-frames guard blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
