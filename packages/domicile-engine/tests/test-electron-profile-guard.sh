#!/usr/bin/env bash
# Tests which end the Electron profile guard blames and which results it
# passes.
#
# Runs the verdict block from `guard-electron-profile.sh` itself, not a copy,
# like the other guards' tests. Key cases: a window outside its profile, a
# link kept in the app's partition and a popup sent out are each a failure.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-electron-profile.sh"
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

# MEASURED is "<ready> <in-work> <link-out> <popup-kept> <unknown-refused>".
echo "the claim — an app in profile work, and its links"
expect "everything in its place is the pass" "pass" "$(verdict "1 1 1 1 1")"
expect "no ready is a failure" "fail" "$(verdict "0 0 0 0 1")"
expect "and blames waiting on the profile" "yes" \
  "$(says "0 0 0 0 1" "WhenAppProfileReady")"
expect "a window outside work is a failure" "fail" "$(verdict "1 0 1 1 1")"
expect "and names where the profile goes" "yes" \
  "$(says "1 0 1 1 1" "OpenElectron")"
expect "a link kept in the app is a failure" "fail" "$(verdict "1 1 0 1 1")"
expect "and names the patch" "yes" "$(says "1 1 0 1 1" "0239")"
expect "a popup sent out is a failure" "fail" "$(verdict "1 1 1 0 1")"

echo
echo "the control — a profile the desk has not got"
expect "one that was not refused is a failure" "fail" \
  "$(verdict "1 1 1 1 0")"
expect "an empty measurement is a failure" "fail" "$(verdict "")"

[ "$FAILED" -eq 0 ] && echo "all ok"
exit "$FAILED"
