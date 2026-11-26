#!/usr/bin/env bash
# Tests which results `guard-webview-slide-screen-rects.sh` passes.
#
# Runs the guard's own verdict block, not a copy. Key cases:
#
#   - The claim passes on a few updates and fails on one a frame, naming
#     patch 0281.
#   - No update at all fails: the page never learned its new place.
#   - The control passes only on many, so the claim's few are the build's
#     doing.
#   - A shell that never ran, a page never shown, a slide that never ended
#     or a trace that missed it fails.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-slide-screen-rects.sh"
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

verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    MAX_UPDATES=3
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
    MAX_UPDATES=3
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<mode> <shell> <page> <done> <traced> <updates>".
echo "the claim — the engine as built"
expect "one update, at the end, is the pass" "pass" "$(verdict "claim 1 1 1 1 1")"
expect "the limit itself passes" "pass" "$(verdict "claim 1 1 1 1 3")"
expect "one a frame is a failure" "fail" "$(verdict "claim 1 1 1 1 57")"
expect "and names the patch" "yes" "$(says "claim 1 1 1 1 57" "patch 0281")"
expect "none at all is a failure" "fail" "$(verdict "claim 1 1 1 1 0")"
expect "and says the page never learned its place" "yes" \
  "$(says "claim 1 1 1 1 0" "new place")"
expect "a trace that missed the slide is a failure" "fail" \
  "$(verdict "claim 1 1 1 0 none")"
expect "and says to trace longer" "yes" \
  "$(says "claim 1 1 1 0 none" "TRACE_SECONDS")"
expect "an unreadable trace is a failure" "fail" "$(verdict "claim 1 1 1 1 none")"
expect "a slide that never ended is a failure" "fail" \
  "$(verdict "claim 1 1 0 0 none")"
expect "a page never shown is a failure" "fail" "$(verdict "claim 1 0 0 0 none")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "claim 0 0 0 0 none")"

echo
echo "the control — a slide on left"
expect "many updates is the control's pass" "pass" \
  "$(verdict "control 1 1 1 1 60")"
expect "a few is the control's failure" "fail" "$(verdict "control 1 1 1 1 2")"
expect "and says the claim then means nothing" "yes" \
  "$(says "control 1 1 1 1 2" "says nothing")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the webview slide screen-rects guard blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
