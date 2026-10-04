#!/usr/bin/env bash
# Tests what `guard-client-window.sh` waits for between starting the compositor
# and starting its client.
#
# The guard waits for the compositor to log that it bound the chrome protocol
# socket. That depends only on the compositor, so it can happen before any
# client runs. `brokered a frame sink` must not satisfy the wait: a client
# produces that line, and the guard starts its client only after this wait.
# `guard-two-windows.sh` shows the right order for that line: `start_client`,
# then `await_broker`.
#
# The block is cut out of the real script, as `test-shell-guard.sh` does, so a
# rewrite that moves it fails here. It reports through the real `annotate`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The real `annotate`, as test-annotate.sh does: the annotation text is the
# behavior under test.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From recording the compositor's pid to the comment that starts the next
# stage. Neither end belongs to the wait, so the slice holds the whole wait
# whatever its shape.
BLOCK="$(awk '/^STARTED\+=\("\$COMP"\)$/,/^# Which wayland socket it opened for apps\.$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no compositor wait in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
at_most() { # what, ceiling, got
  case "$3" in
    (''|*[!0-9]*) printf '  FAIL  %s\n    not a number: %s\n' "$1" "$3"
      FAILED=$((FAILED + 1)); return ;;
  esac
  if [ "$3" -le "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted at most: %ss\n    took:           %ss\n' \
      "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The compositor's line once startup is far enough to start a client. Built
# from the format string at domicile-compositor's main.rs:813, so rewording
# that log site must be mirrored here.
#
# `bind_chrome_socket` runs on the main thread and a failed bind ends the run,
# so this line means the socket is bound. The wayland socket the client dials
# is created before it.
UP='2026-09-22T00:03:21.004411Z  INFO domicile_compositor: chrome protocol socket up path="/run/user/0/domicile-client-window.sock"'
# Built from engine_session.rs:208. Only a client produces this line, so a wait
# it satisfies cannot finish before the client starts.
BROKERED='2026-09-22T00:04:29.112233Z  INFO domicile_compositor: the browser brokered a frame sink app_id=app-1 surface=1'
# Runs the wait against a compositor whose log holds `$2` and which is `alive`
# or `dead`. Prints the block's message and the seconds it took, one per line.
#
# The stand-in compositor outlives every case. The block uses `kill -0` to tell
# a dead compositor from a quiet one, so a stand-in reaped mid-loop would
# produce the wrong message.
#
# Not a pipeline: that would run the block in a subshell where `exit 1` leaves
# only the subshell, so a test could pass with the stop deleted.
wait_for() { # $1 how patient, $2 what the log holds, $3 alive or dead
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  printf '%s\n' "$2" >"$dir/comp"
  # Started out here with output discarded. The block exits on every failing
  # case without killing what it started, and a background process holding the
  # command substitution's write end would keep it open for 900s.
  local comp
  sleep 900 >/dev/null 2>&1 & comp=$!
  if [ "$3" = dead ]; then
    kill "$comp" 2>/dev/null
    wait "$comp" 2>/dev/null
  fi
  local began; began="$(date +%s)"
  (
    COMPOSITOR_LOOKS="$1"
    COMP_LOG="$dir/comp"
    COMP_SOCK="$dir/sock"
    COMP="$comp"
    STARTED=()
    eval "$BLOCK" >"$dir/out" 2>&1
  )
  local waited=$(($(date +%s) - began))
  kill "$comp" 2>/dev/null
  wait "$comp" 2>/dev/null
  # The annotation's title only. `annotate_from` appends the compositor log
  # after `%0A%0A`, and that varies with the fixture, not the behavior.
  local said; said="$(head -1 "$dir/out")"
  printf '%s\n%s\n' "${said%%"%0A"*}" "$waited"
}

# Only the compositor's startup line is in the log; no client has started.
# That must be enough.
r="$(wait_for 120 "$UP" alive)"
expect "a compositor that bound its chrome socket is a compositor to start a client against" \
  "the compositor is up, and nothing has asked it for a window yet" \
  "$(printf '%s\n' "$r" | head -1)"
# The wait must finish quickly once the line is present. Ten seconds is well
# above the cost of reading the file and well below the 60s of a full wait.
at_most "and it does not spend a minute finding that out" \
  10 "$(printf '%s\n' "$r" | tail -1)"

# A wait satisfied by the frame-sink line could not finish before the client
# starts. This case stops the grep from being widened to match both lines.
r="$(wait_for 2 "$BROKERED" alive)"
expect "a frame sink is not what a compositor's readiness looks like" \
  "::error::guard-client-window: the compositor is running and never bound its chrome socket" \
  "$(printf '%s\n' "$r" | head -1)"

# A compositor that never logs anything must end the wait with a message,
# instead of running until GitHub's `timeout-minutes` kills the job.
r="$(wait_for 2 "" alive)"
expect "a compositor that never says it is up ends the wait" \
  "::error::guard-client-window: the compositor is running and never bound its chrome socket" \
  "$(printf '%s\n' "$r" | head -1)"

# A dead compositor gets a different message from a quiet one, so the reader
# knows which end to look at.
r="$(wait_for 120 "" dead)"
expect "a compositor that died says so instead" \
  "::error::guard-client-window: the compositor did not start" \
  "$(printf '%s\n' "$r" | head -1)"

# The default, which CI uses: neither workflow sets `COMPOSITOR_LOOKS`. A
# floor, so the guard stays as patient on a slow machine.
LOOKS_DEFAULT="$(sed -n 's/^COMPOSITOR_LOOKS="${COMPOSITOR_LOOKS:-\([0-9]*\)}"$/\1/p' "$GUARD")"
case "$LOOKS_DEFAULT" in
  (''|*[!0-9]*)
    printf '  FAIL  %s\n    read: %s\n' \
      "the default patience is a number this can read" "$LOOKS_DEFAULT"
    FAILED=$((FAILED + 1)) ;;
  (*)
    if [ "$LOOKS_DEFAULT" -ge 120 ]; then
      printf '  ok    %s\n' "and it is no less patient than it was before it could be satisfied"
    else
      printf '  FAIL  %s\n    %s half-second looks, and it used to be 120\n' \
        "and it is no less patient than it was before it could be satisfied" \
        "$LOOKS_DEFAULT"
      FAILED=$((FAILED + 1))
    fi ;;
esac

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
