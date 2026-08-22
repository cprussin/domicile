#!/usr/bin/env bash
# What `check.sh` says when Xvfb hands it no display.
#
# The unit is `xvfb_verdict`, which is the whole of the diagnosis: a display
# that never arrived used to reach the checks as `no display`, a restatement of
# the question, and this is the function that replaced it with an answer. It
# takes a pid, a log and a deadline and returns a sentence, so none of this
# needs an X server, a display, or Electron — two `mktemp`s and a `bash -c
# 'exit 3'` reproduce every outcome the harness can report.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-verdict.sh
. "$ROOT/scripts/xvfb-verdict.sh"

FAILED=0

# The whole sentence, compared whole. A verdict is read by a person in a CI log
# and its wording *is* the behaviour — matching a substring would pass on the
# `no display` this exists to delete.
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# The server under discussion, in `PID`. Set into a variable rather than
# echoed, because echoing means `$( )` and a `$( )` would own the child: the
# verdict is read from a command substitution of its own, and one subshell
# cannot `wait` on another's job. That is the caller's shape exactly —
# `check.sh` starts Xvfb in its main shell and reads the verdict through
# `$( )` — and building the fixture the other way is how this test first
# reported `Xvfb exited 127` against production code that was correct.
PID=""

# Exited and reaped, which is the only state the "exited" arm is ever reached
# in: `check.sh` gets there by way of a `kill -0` that failed, and a child bash
# has not yet reaped is a zombie `kill -0` still calls alive. The `sleep` is
# what reaps it — it is a foreground `waitpid` — so this arrives at the verdict
# by the caller's route rather than by one that might reap at another time.
spawn_dead() {
  bash -c "exit $1" &
  PID=$!
  while kill -0 "$PID" 2>/dev/null; do sleep 0.05; done
}

spawn_live() {
  sleep 30 &
  PID=$!
}

say() {
  local log; log="$(mktemp)"
  printf '%s' "$1" >"$log"
  echo "$log"
}

echo "== xvfb_verdict =="

SILENT="$(say '')"
spawn_dead 3
expect "a server that died says so with its status" \
  "Xvfb exited 3" \
  "$(xvfb_verdict "$PID" "$SILENT" 60)"

SPOKE="$(say '(EE) Fatal server error:
(EE) Cannot establish any listening sockets
')"
spawn_dead 1
expect "a server that died quotes itself, on one line" \
  "Xvfb exited 1 — it said: (EE) Fatal server error: (EE) Cannot establish any listening sockets" \
  "$(xvfb_verdict "$PID" "$SPOKE" 60)"

BLANK="$(say '
   
')"
spawn_dead 3
expect "a log of nothing but whitespace counts as silence" \
  "Xvfb exited 3" \
  "$(xvfb_verdict "$PID" "$BLANK" 60)"

# An X server's messages are not a format string, and the day one of them
# carries a `%s` is not the day to find out that this was built with one.
PERCENT="$(say 'Cannot allocate 100% of 4%s pages')"
spawn_dead 1
expect "a message full of percent signs survives intact" \
  "Xvfb exited 1 — it said: Cannot allocate 100% of 4%s pages" \
  "$(xvfb_verdict "$PID" "$PERCENT" 60)"

spawn_live
expect "a server still running names the deadline it outlasted" \
  "Xvfb named no display in 7s" \
  "$(xvfb_verdict "$PID" "$SILENT" 7)"
kill "$PID" 2>/dev/null

WARMING="$(say 'warming up')"
spawn_live
expect "a server still running quotes what it managed to say" \
  "Xvfb named no display in 60s — it said: warming up" \
  "$(xvfb_verdict "$PID" "$WARMING" 60)"
kill "$PID" 2>/dev/null

rm -f "$SILENT" "$SPOKE" "$BLANK" "$PERCENT" "$WARMING"

[ "$FAILED" -eq 0 ]
