#!/usr/bin/env bash
# Tests how `guard-webview-paused.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Embeds while paused that never waited pass, whatever the frame counts.
#   - One paused embed that waited fails, and names the engine code that
#     holds the shell.
#   - Waits are counted only from "dialog-claimed" to "played paused-shrink".
#   - A log without waits before the dialog fails: its 0 would mean nothing.
#   - Paused animations that embed nothing new pass: a transform holds the
#     frame (patches 0233, 0281), so nothing waits.
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

# Writes a log with one line per argument: "waits" and "at-once" are the
# shell renderer's embeds, anything else a shell console line.
reads() { # lines...
  for line in "$@"; do
    case "$line" in
    waits) printf '[2:2:INFO:remote_frame.cc(1115)] domicile: a <webview> embeds its page'"'"'s new surface and waits for the page to draw it (not resizing, the page draws anew)\n' ;;
    at-once) printf '[2:2:INFO:remote_frame.cc(1115)] domicile: a <webview> embeds its page'"'"'s new surface at once (not resizing, a new scale alone)\n' ;;
    *) printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: domicile://shell/guard-webview-paused.js (7)\n' "$line" ;;
    esac
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

echo "reading the log"
expect "four animations, in any order" "121 120 110 108 0 0 0" \
  "$(reads "played running-slide frames=121" "played running-shrink frames=120" \
    "dialog-claimed" "played paused-shrink frames=108" \
    "played paused-slide frames=110")"
expect "one never played reads 0" "121 120 0 108 0 0 0" \
  "$(reads "played running-slide frames=121" "played running-shrink frames=120" \
    "played paused-shrink frames=108")"
expect "none played reads all 0" "0 0 0 0 0 0 0" "$(reads "shell-loaded")"
expect "waits before the dialog, none while paused" "121 120 110 108 2 0 3" \
  "$(reads waits "played running-slide frames=121" "played running-shrink frames=120" \
    waits "dialog-claimed" "played paused-slide frames=110" at-once at-once \
    at-once "played paused-shrink frames=108")"
expect "a wait while paused is counted" "121 120 110 108 1 1 1" \
  "$(reads waits "played running-slide frames=121" "played running-shrink frames=120" \
    "dialog-claimed" waits "played paused-slide frames=110" at-once \
    "played paused-shrink frames=108")"
expect "embeds after the last animation are not" "121 120 110 108 1 0 1" \
  "$(reads waits "played running-slide frames=121" "played running-shrink frames=120" \
    "dialog-claimed" at-once "played paused-shrink frames=108" \
    "played paused-slide frames=110" waits at-once)"

# MEASURED is "<shell> <page> <paused> <run-slide> <run-shrink> <paused-slide>
# <paused-shrink> <waits-before> <paused-waits> <paused-at-once>".
echo
echo "the verdict"
expect "no wait while paused is the pass" "pass" \
  "$(verdict "1 1 1 121 120 110 108 2 0 40")"
expect "a slow machine's few frames still pass" "pass" \
  "$(verdict "1 1 1 121 120 35 33 2 0 12")"
expect "one wait while paused fails" "fail" \
  "$(verdict "1 1 1 121 121 110 108 2 1 40")"
expect "and names the compositing rect" "yes" \
  "$(says "1 1 1 121 121 110 108 2 1 40" "RemoteFrameView::ComputeCompositingRect")"
expect "and the embed of a new scale" "yes" \
  "$(says "1 1 1 121 121 110 108 2 1 40" "RemoteFrame::SynchronizeVisualProperties")"
expect "no wait before the dialog fails" "fail" \
  "$(verdict "1 1 1 121 120 110 108 0 0 40")"
expect "and says the log is missing" "yes" \
  "$(says "1 1 1 121 120 110 108 0 0 40" "--vmodule=remote_frame=1")"
expect "no paused embed at all passes: a transform holds the frame" "pass" \
  "$(verdict "1 1 1 121 120 110 108 2 0 0")"
expect "a page that never paused fails" "fail" \
  "$(verdict "1 1 0 121 121 120 120 2 0 40")"
expect "and says so before comparing" "yes" \
  "$(says "1 1 0 121 121 120 120 2 0 40" "never paused")"
expect "a page that paused before the running animations fails" "fail" \
  "$(verdict "1 1 1 0 121 37 32 2 0 40")"
expect "paused animations that never finished fail" "fail" \
  "$(verdict "1 1 1 121 121 0 0 2 0 0")"
expect "a page that never loaded fails" "fail" \
  "$(verdict "1 0 0 0 0 0 0 0 0 0")"
expect "a shell that never ran fails" "fail" \
  "$(verdict "0 0 0 0 0 0 0 0 0 0")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the paused-webview guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
