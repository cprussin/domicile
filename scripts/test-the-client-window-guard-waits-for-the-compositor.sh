#!/usr/bin/env bash
# What `guard-client-window.sh` waits for between starting the compositor and
# starting its client, asserted.
#
# WHAT THIS IS ABOUT. That wait used to be for `brokered a frame sink`, which
# the compositor logs from `surface_for` in `engine_session.rs` — and
# `surface_for` is reached when a WAYLAND CLIENT COMMITS A FRAME. The guard
# does not start its client until after this block. So the grep could not match
# however long it ran, the loop spent all 120 of its half-second looks, and
# every run of the guard — green ones included, on both `engine.yml` and
# `pinned-engine.yml` — paid a guaranteed minute for a signal that could not
# arrive. It was measured: `lib-control-budget.sh` records the whole guard step
# at ~1m05 of which the draw poll was ~5s.
#
# It was worse than slow. The client was started a minute later than it needed
# to be, which is what put `spike-page.html`'s 20s embed deadline out of reach
# by construction and printed a second line reading as a failure on every green
# run.
#
# `guard-two-windows.sh` has the right shape and is worth reading beside this:
# `start_client` first, then `await_broker`. A frame sink is a fact about a
# CLIENT, so it can only be waited for once there is one.
#
# WHAT IT WAITS FOR NOW is the compositor saying its own startup got as far as
# binding the chrome protocol socket, which is a fact about the COMPOSITOR and
# therefore reachable with nothing else running. The cases below are the run
# that works and the three failures it has to be told apart from, plus the
# defect stated from the other side: a line only a client can produce is not
# what a compositor's readiness looks like.
#
# The block is run out of the real script rather than copied, as
# `test-shell-guard.sh` does, so a rewrite that moves it fails here loudly
# instead of leaving this passing against a version nobody ships, and it
# reports through the real `annotate`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The real one, as test-annotate.sh does: what a guard says is the behavior,
# and a stub that spells `::error::` itself would not be it.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From the compositor's pid being recorded to the comment that introduces the
# next stage. Both ends are whole lines, and both are lines the block itself
# does not own — so this slice is the wait and nothing but the wait, whichever
# shape the wait is in.
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

# What the compositor writes when its own startup has got far enough for a
# client to be worth starting. BUILT from the format string at
# domicile-compositor's main.rs:813 rather than copied: reword that log site
# and this test keeps passing while the guard stops seeing the line.
#
# `bind_chrome_socket` runs on the main thread and a failed bind ends the run,
# so this line means the socket is bound — and the wayland listening socket,
# which the client actually dials, was made above it.
UP='2026-09-22T00:03:21.004411Z  INFO domicile_compositor: chrome protocol socket up path="/run/user/0/domicile-client-window.sock"'
# The line the wait used to be for. BUILT from engine_session.rs:208, and here
# for one purpose: a client is what produces it, so a block satisfied by this
# is a block that cannot be satisfied before its client exists. That is the
# defect, and the case below is the only one that can state it.
BROKERED='2026-09-22T00:04:29.112233Z  INFO domicile_compositor: the browser brokered a frame sink app_id=app-1 surface=1'

# The wait, against a compositor whose log holds `$2` and which is either
# `alive` or `dead`. Prints what the block said and how long it took, one per
# line, so a case can assert on either.
#
# A compositor that outlives every case by a wide margin, rather than one timed
# to the case: `kill -0` is how the block tells a compositor that died from one
# that is quiet, and a stand-in reaped while the block is still looping would
# hand a case the other sentence and read as the defect it is testing for.
#
# Deliberately NOT a pipeline: a pipeline puts the block in a subshell, `exit
# 1` leaves only that, and what follows runs anyway — so a test written that
# way pins the sentence and lets the stop be deleted.
wait_for() { # $1 how patient, $2 what the log holds, $3 alive or dead
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  printf '%s\n' "$2" >"$dir/comp"
  # Out here rather than inside the subshell, with its output sent nowhere: the
  # block ends in `exit` on every failing case, which leaves whatever it
  # started running — and a background process holding the write end of this
  # function's command substitution keeps it open for the whole 900s.
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
  # The annotation's title, without the log it carries. `annotate_from` puts
  # the tail of the compositor's own words after a `%0A%0A`, which is what a
  # person reading the check wants and is not what a case here is about — and
  # a fixture log is the one thing a case can always change without the
  # behavior changing at all.
  local said; said="$(head -1 "$dir/out")"
  printf '%s\n%s\n' "${said%%"%0A"*}" "$waited"
}

# THE ONE THAT WAS COSTING A MINUTE A RUN. Nothing but the compositor's own
# startup is in this log — no client has been started, because starting one is
# what comes after this block — and that has to be enough.
r="$(wait_for 120 "$UP" alive)"
expect "a compositor that bound its chrome socket is a compositor to start a client against" \
  "the compositor is up, and nothing has asked it for a window yet" \
  "$(printf '%s\n' "$r" | head -1)"
# The whole claim, and the reason the assertion is a clock rather than a
# sentence: the old wait ran its full 120 looks at half a second each on every
# green run there has ever been. Ten seconds is far above what reading a file
# that already has the line in it can cost and far below the minute.
at_most "and it does not spend a minute finding that out" \
  10 "$(printf '%s\n' "$r" | tail -1)"

# THE DEFECT, STATED FROM THE OTHER SIDE. A frame sink is brokered when a
# client commits, so a wait satisfied by this line is a wait that cannot end
# before the client the guard has not started yet. Without this case, widening
# the grep to match both lines would pass everything above.
r="$(wait_for 2 "$BROKERED" alive)"
expect "a frame sink is not what a compositor's readiness looks like" \
  "::error::guard-client-window: the compositor is running and never bound its chrome socket" \
  "$(printf '%s\n' "$r" | head -1)"

# The bound, which the case above rests on: a compositor that never says
# anything must end the wait and say so, rather than run until GitHub's
# `timeout-minutes` kills the job — which reports nothing about the seam.
r="$(wait_for 2 "" alive)"
expect "a compositor that never says it is up ends the wait" \
  "::error::guard-client-window: the compositor is running and never bound its chrome socket" \
  "$(printf '%s\n' "$r" | head -1)"

# The failure this block has always been able to name, kept: a compositor that
# died is a different sentence from one that is running and quiet, and telling
# them apart is what sends whoever reads the annotation to the right end.
r="$(wait_for 120 "" dead)"
expect "a compositor that died says so instead" \
  "::error::guard-client-window: the compositor did not start" \
  "$(printf '%s\n' "$r" | head -1)"

# How patient it is by default, which is the number CI runs: neither workflow
# sets `COMPOSITOR_LOOKS`. A floor rather than a value, and the floor is what
# the wait used to cost — the point of this change is that the wait can now be
# satisfied, not that the guard got less willing to wait on a slow machine.
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
