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

BOOKKEEPER="$(a_compositor "$$")"
expect "a compositor is three processes, not one" 3 "$(alive "$$")"

kill "$BOOKKEEPER" 2>/dev/null
settle 2 "$$"
expect "killing the pid the shell has leaves the other two behind" \
  2 "$(alive "$$")"

SAID="$(kill_compositors "$$" 2>&1)"
settle 0 "$$"
expect "and the sweep takes them" 0 "$(alive "$$")"
says "which it says, with a count" '2 processes' "$SAID"

# --- a run only ever collects its own ---------------------------------------

a_compositor "$$" >/dev/null
a_compositor 999999 >/dev/null
kill_compositors "$$" >/dev/null 2>&1
settle 0 "$$"
expect "this run's compositor is gone" 0 "$(alive "$$")"
expect "and another run's is untouched" 3 "$(alive 999999)"
# Taken properly rather than by pid: two orphaned children left here would be
# leftover compositor processes, which is exactly what the next case counts.
kill_compositors 999999 >/dev/null 2>&1

# --- the leftover sweep spares a run that is still going ---------------------

# A process marked the way under-wayland.sh marks itself, so that the sweep can
# see there is still somebody behind the compositor below.
bash -c 'export DOMICILE_UNDER_WAYLAND=$$; exec sleep 300' >/dev/null 2>&1 &
STARTER=$!
disown "$STARTER"
SPAWNED="$SPAWNED $STARTER"
sleep 0.3
a_compositor "$STARTER" >/dev/null
expect "a compositor whose starter is still running is not leftover" \
  0 "$(alive)"
kill_compositors >/dev/null 2>&1
expect "so the sweep leaves it alone" 3 "$(alive "$STARTER")"

# --- and collects one whose starter is gone ----------------------------------

kill -KILL "$STARTER" 2>/dev/null
wait "$STARTER" 2>/dev/null
expect "once the starter is gone its compositor is leftover" 3 "$(alive)"
SAID="$(kill_compositors 2>&1)"
settle 0 "$STARTER"
expect "and the sweep takes it" 0 "$(alive "$STARTER")"
says "saying whose it was not" 'previous run' "$SAID"

# --- a pid is not a starter --------------------------------------------------

# THE REASON THE STARTER CARRIES A MARKER OF ITS OWN. A pid alone answers "yes,
# still running" for whatever process inherited that number next, and these
# runners are up for weeks. A live process that is not an under-wayland.sh must
# not protect the compositor that pid once started.
sleep 300 >/dev/null 2>&1 &
IMPOSTOR=$!
disown "$IMPOSTOR"
SPAWNED="$SPAWNED $IMPOSTOR"
a_compositor "$IMPOSTOR" >/dev/null
expect "a compositor whose pid belongs to something else is leftover" \
  3 "$(alive)"
kill_compositors >/dev/null 2>&1
settle 0 "$IMPOSTOR"
expect "and the sweep takes it" 0 "$(alive "$IMPOSTOR")"
kill -KILL "$IMPOSTOR" 2>/dev/null

# --- somebody else's runtime directory ---------------------------------------

ELSEWHERE_DIR="$(mktemp -d)"
env DOMICILE_COMPOSITOR=999998 XDG_RUNTIME_DIR="$ELSEWHERE_DIR" \
  sleep 300 >/dev/null 2>&1 &
ELSEWHERE=$!
disown "$ELSEWHERE"
SPAWNED="$SPAWNED $ELSEWHERE"
sleep 0.3
expect "a compositor in another runtime directory is none of this one's business" \
  0 "$(alive)"
expect "not even by name" 0 "$(alive 999998)"
kill -KILL "$ELSEWHERE" 2>/dev/null
rm -rf "$ELSEWHERE_DIR"

# --- one that will not take SIGTERM ------------------------------------------

# A hang here is a job that never ends, which is worse than the leak, so the
# second pass is not optional.
a_compositor "$$" 'trap "" TERM; sleep 300' >/dev/null
SAID="$(kill_compositors "$$" 2>&1)"
settle 0 "$$"
expect "one that ignores SIGTERM is killed anyway" 0 "$(alive "$$")"
says "and is named as having needed it" 'would not take SIGTERM' "$SAID"


# --- the script this exists for ----------------------------------------------

# A LIBRARY NOTHING CALLS IS A LEAK THAT QUIETLY CAME BACK. Every case above
# stays green if `under-wayland.sh` goes on ending its compositor the old way.
for call in lib-compositor-cleanup.sh compositor_env DOMICILE_UNDER_WAYLAND; do
  if grep -q "$call" "$SCRIPT"; then
    ok "under-wayland.sh has $call"
  else
    printf '  FAIL  under-wayland.sh has %s\n' "$call"
    FAILED=$((FAILED + 1))
  fi
done
if grep -q 'kill_compositors "\$\$"' "$SCRIPT"; then
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
