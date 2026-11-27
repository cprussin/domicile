#!/usr/bin/env bash
# Tests which end the Electron debugged-window guard blames and which results it
# passes.
#
# Runs the verdict block from `guard-electron-debugged.sh` itself, not a copy,
# like the other guards' tests. Key case: an engine that died is that failure
# whatever else was measured, since a dead engine measures nothing else.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-electron-debugged.sh"
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

# MEASURED is "<ready> <attached> <loaded> <alive>".
echo "the claim — a window opens and loads under an auto-attached DevTools client"
expect "everything holding is the pass" "pass" "$(verdict "1 1 1 1")"
expect "no hello is a failure" "fail" "$(verdict "0 0 0 0")"
expect "and points at the socket's guard" "yes" \
  "$(says "0 0 0 0" "guard-electron-socket.sh")"
expect "a dead engine is a failure" "fail" "$(verdict "1 0 0 0")"
expect "and names the zoom it died on last time" "yes" \
  "$(says "1 0 0 0" "ZoomController")"
expect "even when the client was attached and the page loaded" "yes" \
  "$(says "1 1 1 0" "THE ENGINE DIED")"
expect "a client never attached is a failure" "fail" "$(verdict "1 0 1 1")"
expect "and says nothing was measured" "yes" \
  "$(says "1 0 1 1" "nothing here was measured")"
expect "a page that never loaded is a failure" "fail" "$(verdict "1 1 0 1")"
expect "and points at the socket's guard to compare" "yes" \
  "$(says "1 1 0 1" "guard-electron-socket.sh")"
expect "an empty measurement is a failure" "fail" "$(verdict "")"

[ "$FAILED" -eq 0 ] && echo "all ok"
exit "$FAILED"
