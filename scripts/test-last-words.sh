#!/usr/bin/env bash
# Tests `lib-last-words.sh`, which prints the end of an engine's log for a
# failed guard.
#
# A crashed engine's stack runs past forty lines, so a plain `tail -40` cut
# the `Check failed` line and the frames that name the check. Each test
# compares the whole output.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$ROOT/packages/domicile-engine/scripts/lib-last-words.sh"

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

FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

# `$count` numbered lines, `line 1` to `line $count`.
numbered() {
  seq 1 "$1" | sed 's/^/line /'
}

QUIET="$FIXTURES/quiet.log"
numbered 100 >"$QUIET"
expect "a log with no crash ends in its last forty lines" \
  "$(numbered 100 | tail -40)" \
  "$(last_words "$QUIET")"

# The fatal line, then a stack longer than forty frames, then more lines.
CRASHED="$FIXTURES/crashed.log"
{
  numbered 100
  echo "[1:1:1005/094108.1:FATAL:content/x.cc(12)] Check failed: is_loading_."
  seq 0 45 | sed 's/^/#/; s/$/ 0x0 frame()/'
  echo "[end of stack trace]"
  echo "after the crash"
} >"$CRASHED"
expect "a crash further back than forty lines keeps its fatal line" \
  "$(tail -49 "$CRASHED")" \
  "$(last_words "$CRASHED")"

expect "the crash alone, from its fatal line to the end of its stack" \
  "$(tail -49 "$CRASHED" | head -48)" \
  "$(crash_of "$CRASHED")"

expect "a log with no crash has none" "" "$(crash_of "$QUIET")"

expect "a log that is not there has no last words" \
  "" "$(last_words /nonexistent/log 2>/dev/null)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
