#!/usr/bin/env bash
# That stopping a nested compositor stops all of it, asserted.
#
# `under-wayland.sh` used to end its compositor with `kill "$COMPOSITOR"`, and
# that pid is not sway's. nixpkgs' sway wrapper execs `dbus-run-session`, which
# forks both the bus and sway so it can shut the bus down afterwards — so the
# pid a `&` hands back belongs to the bookkeeper, and SIGTERM to the bookkeeper
# orphans the work. Measured on crux mid-job: eight {dbus-daemon, sway, swaybg}
# triples with no dbus-run-session over any of them, which is exactly one per
# under-wayland.sh step that job had already finished. Eight idle compositors,
# 11.9G resident on the unit, each holding an EGL context on the render node —
# next to guard-latency.sh, whose whole output is a number of milliseconds.
#
# EVERY WAY THE FIX CAN BE WRONG IS A COMPOSITOR SOMEBODY IS USING, so the
# cases below are mostly about what must *survive* a sweep rather than what
# must not. The shape under test is the shape that leaked: a bookkeeper with
# two forked children, killed the way the old code killed it.
#
# AND A FIXTURE THAT IS NOT THE PRODUCTION SHAPE IS A CHECK THAT CANNOT FAIL.
# The live-run case below used to stand up its starter with `exec sleep 300`
# after exporting a marker, which put that marker in a fresh process's exec
# environment — and `under-wayland.sh` never execs, so its own marker was in no
# such place. A check that could not succeed was green for a month because the
# only process it was ever asked about was one the production script could not
# produce. So the starter here is a shell that goes on being itself, and what a
# run is named by is read from outside it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-compositor-cleanup.sh"
SCRIPT="$ROOT/packages/domicile-engine/scripts/under-wayland.sh"
[ -f "$LIB" ] || { echo "no $LIB" >&2; exit 1; }

# Every marker this reads is in /proc/<pid>/environ, so a machine without a
# procfs cannot run this at all. 77 is how a check says it did not run, which
# is the only thing that distinguishes it from one that ran and passed.
if [ ! -r /proc/self/environ ]; then
  echo "SKIP: no readable procfs, so there is nothing to read a marker out of"
  exit 77
fi

XDG_RUNTIME_DIR="$(mktemp -d)"
export XDG_RUNTIME_DIR
SPAWNED=""
trap 'for p in $SPAWNED; do kill -KILL "$p" 2>/dev/null; done
      rm -rf "$XDG_RUNTIME_DIR"' EXIT

# shellcheck source=packages/domicile-engine/scripts/lib-compositor-cleanup.sh
. "$LIB"

# This script standing in for one under-wayland.sh run, named the way the
# library names one.
MINE="$(compositor_owner)"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
says() { # what, pattern, text
  if printf '%s\n' "$3" | grep -q "$2"; then ok "$1"; else
    printf '  FAIL  %s\n    nothing matching: %s\n    it said: %s\n' \
      "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# A bookkeeper and the two processes it forks, all three carrying the marker —
# the shape of dbus-run-session, dbus-daemon and sway. $1 is the pid the
# compositor is to be recorded as belonging to; $2, when given, is a shell
# snippet the children run instead of waiting quietly.
a_compositor() { # owner [what the children do]
  local owner="$1" children="${2:-sleep 300}"
  # Its own stdout, or the `$(...)` this is called in waits for the whole
  # compositor to exit before handing back the pid of the thing to kill.
  env DOMICILE_COMPOSITOR="$owner" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    bash -c "$children & $children & wait" >/dev/null 2>&1 &
  local bookkeeper=$!
  # Off the job table, so that the shell does not narrate each kill below;
  # the trap still has the pid.
  disown "$bookkeeper"
  SPAWNED="$SPAWNED $bookkeeper"
  local attempt
  for attempt in $(seq 1 50); do
    [ "$(compositor_count "$(compositor_pids "$owner")")" = 3 ] && break
    sleep 0.1
  done
  printf '%s\n' "$bookkeeper"
}

alive() { # owner
  compositor_count "$(compositor_pids "${1:-}")"
}

# Wait for a kill to land, so that a count is of a settled machine.
settle() { # how many, owner
  local attempt
  for attempt in $(seq 1 50); do
    [ "$(alive "${2:-}")" = "$1" ] && return 0
    sleep 0.1
  done
}

# --- the shape that leaked ---------------------------------------------------

BOOKKEEPER="$(a_compositor "$MINE")"
expect "a compositor is three processes, not one" 3 "$(alive "$MINE")"

kill "$BOOKKEEPER" 2>/dev/null
settle 2 "$MINE"
expect "killing the pid the shell has leaves the other two behind" \
  2 "$(alive "$MINE")"

SAID="$(kill_compositors "$MINE" 2>&1)"
settle 0 "$MINE"
expect "and the sweep takes them" 0 "$(alive "$MINE")"
says "which it says, with a count" '2 processes' "$SAID"

# --- a run only ever collects its own ---------------------------------------

# 999999:1 is a run that cannot be: no process holds that pid here, and none
# started one clock tick after boot. It stands in for another run's compositor
# throughout — what a sweep by name must not reach.
a_compositor "$MINE" >/dev/null
a_compositor 999999:1 >/dev/null
kill_compositors "$MINE" >/dev/null 2>&1
settle 0 "$MINE"
expect "this run's compositor is gone" 0 "$(alive "$MINE")"
expect "and another run's is untouched" 3 "$(alive 999999:1)"
# Taken properly rather than by pid: two orphaned children left here would be
# leftover compositor processes, which is exactly what the next case counts.
kill_compositors 999999:1 >/dev/null 2>&1

# --- the leftover sweep spares a run that is still going ---------------------

# A second run, of the shape under-wayland.sh has: a shell that names itself
# with the library's own `compositor_owner` and then goes on being that same
# shell — no `exec`, and nothing exported that anything out here reads. It says
# what it is called through a file, because a `&` hands back a pid and what the
# sweep goes on is the name the run gave itself.
#
# THIS IS THE CASE THAT BIT. Everything below the sweep here is one runner's
# startup sweep with another runner's job already going beside it, as the same
# user and against the same XDG_RUNTIME_DIR path.
TOKEN_FILE="$XDG_RUNTIME_DIR/starter-token"
bash -c ". '$LIB'; compositor_owner > '$TOKEN_FILE'; sleep 300 & wait" \
  >/dev/null 2>&1 &
STARTER=$!
disown "$STARTER"
SPAWNED="$SPAWNED $STARTER"
for attempt in $(seq 1 50); do
  [ -s "$TOKEN_FILE" ] && break
  sleep 0.1
done
THEIRS="$(cat "$TOKEN_FILE")"
a_compositor "$THEIRS" >/dev/null
expect "a compositor whose starter is still running is not leftover" \
  0 "$(alive)"
kill_compositors >/dev/null 2>&1
expect "so the sweep leaves it alone" 3 "$(alive "$THEIRS")"

# --- and collects one whose starter is gone ----------------------------------

kill -KILL "$STARTER" 2>/dev/null
wait "$STARTER" 2>/dev/null
expect "once the starter is gone its compositor is leftover" 3 "$(alive)"
SAID="$(kill_compositors 2>&1)"
settle 0 "$THEIRS"
expect "and the sweep takes it" 0 "$(alive "$THEIRS")"
says "saying whose it was not" 'previous run' "$SAID"

# --- a pid is not a starter --------------------------------------------------

# THE REASON A RUN IS NAMED BY A START TIME AND NOT BY A PID. A pid alone
# answers "yes, still running" for whatever process inherited that number next,
# and these runners are up for weeks. A live process that is not the
# under-wayland.sh that started this compositor must not protect it — so the
# marker below names this pid at a moment one tick after boot, which is not
# when the process now holding it started.
sleep 300 >/dev/null 2>&1 &
IMPOSTOR=$!
disown "$IMPOSTOR"
SPAWNED="$SPAWNED $IMPOSTOR"
a_compositor "$IMPOSTOR:1" >/dev/null
expect "a compositor whose pid belongs to something else is leftover" \
  3 "$(alive)"
kill_compositors >/dev/null 2>&1
settle 0 "$IMPOSTOR:1"
expect "and the sweep takes it" 0 "$(alive "$IMPOSTOR:1")"
kill -KILL "$IMPOSTOR" 2>/dev/null

# --- somebody else's runtime directory ---------------------------------------

ELSEWHERE_DIR="$(mktemp -d)"
env DOMICILE_COMPOSITOR=999998:1 XDG_RUNTIME_DIR="$ELSEWHERE_DIR" \
  sleep 300 >/dev/null 2>&1 &
ELSEWHERE=$!
disown "$ELSEWHERE"
SPAWNED="$SPAWNED $ELSEWHERE"
sleep 0.3
expect "a compositor in another runtime directory is none of this one's business" \
  0 "$(alive)"
expect "not even by name" 0 "$(alive 999998:1)"
kill -KILL "$ELSEWHERE" 2>/dev/null
rm -rf "$ELSEWHERE_DIR"

# --- one that will not take SIGTERM ------------------------------------------

# A hang here is a job that never ends, which is worse than the leak, so the
# second pass is not optional.
a_compositor "$MINE" 'trap "" TERM; sleep 300' >/dev/null
SAID="$(kill_compositors "$MINE" 2>&1)"
settle 0 "$MINE"
expect "one that ignores SIGTERM is killed anyway" 0 "$(alive "$MINE")"
says "and is named as having needed it" 'would not take SIGTERM' "$SAID"


# --- the script this exists for ----------------------------------------------

# A LIBRARY NOTHING CALLS IS A LEAK THAT QUIETLY CAME BACK. Every case above
# stays green if `under-wayland.sh` goes on ending its compositor the old way.
for call in lib-compositor-cleanup.sh compositor_env compositor_owner; do
  if grep -q "$call" "$SCRIPT"; then
    ok "under-wayland.sh has $call"
  else
    printf '  FAIL  under-wayland.sh has %s\n' "$call"
    FAILED=$((FAILED + 1))
  fi
done
if grep -q 'kill_compositors "\$(compositor_owner)"' "$SCRIPT"; then
  ok "under-wayland.sh stops its own compositor at exit"
else
  printf '  FAIL  under-wayland.sh stops its own compositor at exit\n'
  FAILED=$((FAILED + 1))
fi
if grep -q '^kill_compositors$' "$SCRIPT"; then
  ok "and sweeps what an earlier run left behind"
else
  printf '  FAIL  under-wayland.sh sweeps what an earlier run left behind\n'
  FAILED=$((FAILED + 1))
fi
if grep -v '^[[:space:]]*#' "$SCRIPT" | grep -q 'kill "\$COMPOSITOR"'; then
  printf '  FAIL  under-wayland.sh is back to killing one pid of three\n'
  FAILED=$((FAILED + 1))
else
  ok "and does not kill one pid of the three"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
