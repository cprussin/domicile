#!/usr/bin/env bash
# Tests how `guard-webview-paused.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Paused animations near the running ones' frame counts pass.
#   - A paused slide or shrink under MIN_PERCENT fails, and names the engine
#     code that holds the shell.
#   - A page that never paused, or paused too early, fails before any count
#     is compared.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-paused.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^READ="\$\(awk/,/"\$ENGINE_LOG" 2>\/dev\/null\)"$/' "$GUARD")"
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$READING" ] && [ -n "$BLOCK" ] || {
  echo "no reading or verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

# Writes a log with one shell console line per argument.
reads() { # lines...
  for line in "$@"; do
    printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: domicile://shell/guard-webview-paused.js (7)\n' "$line"
  done >"$WORK/engine.log"
  (
    ENGINE_LOG="$WORK/engine.log"
    eval "$READING"
    echo "$READ"
  )
}

verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    MIN_PERCENT=60
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
    MIN_PERCENT=60
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "reading the log"
expect "four animations, in any order" "121 120 110 108" \
  "$(reads "played running-slide frames=121" "played running-shrink frames=120" \
    "dialog-claimed" "played paused-shrink frames=108" \
    "played paused-slide frames=110")"
expect "one never played reads 0" "121 120 0 108" \
  "$(reads "played running-slide frames=121" "played running-shrink frames=120" \
    "played paused-shrink frames=108")"
expect "none played reads all 0" "0 0 0 0" "$(reads "shell-loaded")"

# MEASURED is "<shell> <page> <paused> <run-slide> <run-shrink> <paused-slide>
# <paused-shrink>".
echo
echo "the verdict"
expect "paused near running is the pass" "pass" \
  "$(verdict "1 1 1 121 120 110 108")"
expect "exactly at the bar passes" "pass" \
  "$(verdict "1 1 1 100 100 60 60")"
expect "a slow paused slide fails" "fail" \
  "$(verdict "1 1 1 121 121 35 110")"
expect "and names the compositing rect" "yes" \
  "$(says "1 1 1 121 121 35 110" "RemoteFrameView::ComputeCompositingRect")"
expect "a slow paused shrink fails" "fail" \
  "$(verdict "1 1 1 121 121 110 33")"
expect "and names the deadline for a new raster scale" "yes" \
  "$(says "1 1 1 121 121 110 33" "RemoteFrame::SynchronizeVisualProperties")"
expect "a page that never paused fails" "fail" \
  "$(verdict "1 1 0 121 121 120 120")"
expect "and says so before comparing" "yes" \
  "$(says "1 1 0 121 121 120 120" "never paused")"
expect "a page that paused before the running animations fails" "fail" \
  "$(verdict "1 1 1 0 121 37 32")"
expect "paused animations that never finished fail" "fail" \
  "$(verdict "1 1 1 121 121 0 0")"
expect "a page that never loaded fails" "fail" \
  "$(verdict "1 0 0 0 0 0 0")"
expect "a shell that never ran fails" "fail" \
  "$(verdict "0 0 0 0 0 0 0")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the paused-webview guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
