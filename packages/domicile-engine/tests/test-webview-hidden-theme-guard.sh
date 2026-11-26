#!/usr/bin/env bash
# Tests which results `guard-webview-hidden-theme.sh` passes.
#
# Runs the guard's own verdict block, not a copy. Key cases:
#
#   - The claim passes on a dark first frame and fails on a light one,
#     naming patch 0285.
#   - The control passes only on a light first frame, so the claim's dark one
#     is the build's doing.
#   - A shell that never ran, or a page never drawn or never drawn dark, fails.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-hidden-theme.sh"
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

verdict() { # $1 MODE, $2 MEASURED
  (
    MODE="$1"
    MEASURED="$2"
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

says() { # $1 MODE, $2 MEASURED, $3 what the sentence must contain
  case "$(
    MODE="$1"
    MEASURED="$2"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$3"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "the claim — the engine as built"
expect "a dark first frame is the pass" "pass" \
  "$(verdict claim "first=dark settled=dark")"
expect "a light first frame is a failure" "fail" \
  "$(verdict claim "first=light settled=dark")"
expect "and names the patch" "yes" \
  "$(says claim "first=light settled=dark" "patch 0285")"
expect "a page never drawn dark is a failure" "fail" \
  "$(verdict claim "first=light settled=light")"
expect "an unknown color first is a failure" "fail" \
  "$(verdict claim "first=other(1,2,3) settled=dark")"

echo "the control — a page that turned itself while hidden"
expect "a light first frame is the pass" "pass" \
  "$(verdict control "first=light settled=dark")"
expect "a dark first frame is a failure" "fail" \
  "$(verdict control "first=dark settled=dark")"

echo "either mode — nothing measured"
for mode in claim control; do
  expect "$mode: a page never drawn is a failure" "fail" \
    "$(verdict "$mode" "first=never")"
  expect "$mode: no debugging port is a failure" "fail" \
    "$(verdict "$mode" "no-port")"
  expect "$mode: a shell that never ran is a failure" "fail" \
    "$(verdict "$mode" "")"
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED case(s) failed" >&2
  exit 1
fi
echo "guard-webview-hidden-theme's verdict holds"
