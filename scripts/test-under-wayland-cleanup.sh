#!/usr/bin/env bash
# Checks that stopping a nested compositor stops all of its processes.
#
# nixpkgs' sway wrapper execs `dbus-run-session`, which forks dbus-daemon and
# sway. The pid that `&` returns is the bookkeeper's, so killing it orphans the
# other two. `lib-compositor-cleanup.sh` finds them by an environment marker
# instead.
#
# Most cases check what a sweep must spare, since a wrong sweep kills a
# compositor another run is using. Fixtures match the production shape: the
# starter is a shell that does not exec. Each assertion waits for the state it
# checks, so a busy machine does not produce false failures.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-compositor-cleanup.sh"
SCRIPT="$ROOT/packages/domicile-engine/scripts/under-wayland.sh"
[ -f "$LIB" ] || { echo "no $LIB" >&2; exit 1; }

# Markers are read from /proc/<pid>/environ. Exit 77 marks the check as
# skipped.
if [ ! -r /proc/self/environ ]; then
  echo "SKIP: no readable procfs, so there is nothing to read a marker out of"
  exit 77
fi
# `a_compositor` waits on /proc/<pid>/task/<pid>/children. Without it the wait
# would never finish.
if [ ! -r "/proc/self/task/$$/children" ]; then
  echo "SKIP: no /proc/<pid>/task/<pid>/children, so a fork cannot be waited for"
  exit 77
fi

XDG_RUNTIME_DIR="$(mktemp -d)"
export XDG_RUNTIME_DIR
SPAWNED=""
trap 'for p in $SPAWNED; do kill -KILL "$p" 2>/dev/null; done
      rm -rf "$XDG_RUNTIME_DIR"' EXIT

# shellcheck source=packages/domicile-engine/scripts/lib-compositor-cleanup.sh
. "$LIB"

# The owner name for this script, standing in for one under-wayland.sh run.
MINE="$(compositor_owner)"

# Timeout in seconds for any wait below. It only ends a hang. Observed waits
# under heavy load were under 0.2s.
PATIENCE=30

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }

# Asserts that a command's output reaches `want`, retrying until `PATIENCE`
# runs out. A count taken right after a kill or spawn can catch the machine
# mid-change. Retrying does not hide a real bug, and the last answer is
# reported.
expect() { # what, want, then the command that says what is
  local what="$1" want="$2" got deadline=$((SECONDS + PATIENCE))
  shift 2
  got="$("$@")"
  while [ "$got" != "$want" ] && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 0.1
    got="$("$@")"
  done
  if [ "$got" = "$want" ]; then ok "$what"; else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
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

# Waits for a fixture to be ready, or exits naming what never happened. Going
# on without the fixture would report failures against the library that are
# really about this script's setup.
wait_for() { # what, then the command that says it is so
  local what="$1" deadline=$((SECONDS + PATIENCE))
  shift
  until "$@"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf '  FAIL  %s\n' "$what"
      printf '    never, in %s seconds. That is this script standing its own\n' \
        "$PATIENCE"
      printf '    scenery up on a busy machine, not the library.\n'
      exit 1
    fi
    sleep 0.1
  done
}

# Starts a bookkeeper that forks two children, all carrying the marker (like
# dbus-run-session, dbus-daemon and sway). $1 is the owner; $2, if given, is
# what the children run.
#
# Returns the bookkeeper's pid in `BOOKKEEPER`, not on stdout. Calling this in
# `$(...)` would run it in a subshell, where `wait_for` exits only the subshell
# and `SPAWNED` updates are lost.
a_compositor() { # owner [what the children do]
  local owner="$1" children="${2:-sleep 300}"
  env DOMICILE_COMPOSITOR="$owner" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    bash -c "$children & $children & wait" >/dev/null 2>&1 &
  BOOKKEEPER=$!
  # Disown so the shell does not report each kill; the trap still has the pid.
  disown "$BOOKKEEPER"
  SPAWNED="$SPAWNED $BOOKKEEPER"
  # Wait on the process table, not `compositor_pids`: the library finding all
  # three is what the cases assert.
  wait_for "the compositor for $owner to have forked its two children" \
    has_forked "$BOOKKEEPER" 2
  # `wait_for` can exit before a case sweeps this compositor. Give the trap
  # the children too, or they outlive the check.
  SPAWNED="$SPAWNED $(children_of "$BOOKKEEPER")"
}

# Whether a process has forked `how many` children yet.
has_forked() { # pid, how many
  [ "$(printf '%s\n' "$(children_of "$1")" | wc -w)" = "$2" ]
}

children_of() { # pid
  { cat "/proc/$1/task/$1/children"; } 2>/dev/null
}

# Whether a process carries the marker. Its environ reflects only what it was
# exec'd with, so this is true only after the exec.
is_marked() { # pid, owner
  { tr '\0' '\n' < "/proc/$1/environ"; } 2>/dev/null |
    grep -Fqx "DOMICILE_COMPOSITOR=$2"
}

alive() { # owner
  compositor_count "$(compositor_pids "${1:-}")"
}

# --- the shape that leaked ---------------------------------------------------

a_compositor "$MINE"
expect "a compositor is three processes, not one" 3 alive "$MINE"

kill "$BOOKKEEPER" 2>/dev/null
expect "killing the pid the shell has leaves the other two behind" \
  2 alive "$MINE"

SAID="$(kill_compositors "$MINE" 2>&1)"
expect "and the sweep takes them" 0 alive "$MINE"
says "which it says, with a count" '2 processes' "$SAID"

# --- a run only ever collects its own ---------------------------------------

# 999999:1 is an owner no live run can have (no such pid, started one tick
# after boot). It stands in for another run.
a_compositor "$MINE"
a_compositor 999999:1
kill_compositors "$MINE" >/dev/null 2>&1
expect "this run's compositor is gone" 0 alive "$MINE"
expect "and another run's is untouched" 3 alive 999999:1
# Sweep it by name; orphaned children would count as leftovers in the next
# case.
kill_compositors 999999:1 >/dev/null 2>&1

# --- the leftover sweep spares a run that is still going ---------------------

# A second run shaped like under-wayland.sh: a shell that names itself with
# `compositor_owner` and does not exec. It writes its name to a file. This
# models one runner's startup sweep while another runner's job is going, as
# the same user with the same XDG_RUNTIME_DIR.
TOKEN_FILE="$XDG_RUNTIME_DIR/starter-token"
bash -c ". '$LIB'; compositor_owner > '$TOKEN_FILE'; sleep 300 & wait" \
  >/dev/null 2>&1 &
STARTER=$!
disown "$STARTER"
SPAWNED="$SPAWNED $STARTER"
wait_for "the second run to publish the name it gave itself" \
  test -s "$TOKEN_FILE"
# The starter's `sleep` has no marker, so no sweep reaches it. Give it to the
# trap, or it outlives the check and holds the CI step's output open.
wait_for "the second run to have forked the child it waits on" \
  has_forked "$STARTER" 1
SPAWNED="$SPAWNED $(children_of "$STARTER")"
THEIRS="$(cat "$TOKEN_FILE")"
a_compositor "$THEIRS"
expect "a compositor whose starter is still running is not leftover" \
  0 alive
kill_compositors >/dev/null 2>&1
expect "so the sweep leaves it alone" 3 alive "$THEIRS"

# --- and collects one whose starter is gone ----------------------------------

kill -KILL "$STARTER" 2>/dev/null
# `wait` returns 0 at once for a disowned pid. Wait until the starter is gone
# from the process table: until it is reaped, its pid still counts as alive.
wait_for "the starter to be gone" test ! -e "/proc/$STARTER"
expect "once the starter is gone its compositor is leftover" 3 alive
SAID="$(kill_compositors 2>&1)"
expect "and the sweep takes it" 0 alive "$THEIRS"
says "saying whose it was not" 'previous run' "$SAID"

# --- a pid is not a starter --------------------------------------------------

# Runs are named by pid and start time, because pids are reused and runners
# stay up for weeks. A live process that reuses the pid must not protect the
# compositor.
sleep 300 >/dev/null 2>&1 &
IMPOSTOR=$!
disown "$IMPOSTOR"
SPAWNED="$SPAWNED $IMPOSTOR"
a_compositor "$IMPOSTOR:1"
expect "a compositor whose pid belongs to something else is leftover" \
  3 alive
kill_compositors >/dev/null 2>&1
expect "and the sweep takes it" 0 alive "$IMPOSTOR:1"
kill -KILL "$IMPOSTOR" 2>/dev/null

# --- somebody else's runtime directory ---------------------------------------

ELSEWHERE_DIR="$(mktemp -d)"
env DOMICILE_COMPOSITOR=999998:1 XDG_RUNTIME_DIR="$ELSEWHERE_DIR" \
  sleep 300 >/dev/null 2>&1 &
ELSEWHERE=$!
disown "$ELSEWHERE"
SPAWNED="$SPAWNED $ELSEWHERE"
# A process that has not started yet would also pass both assertions below,
# so wait until it is up. Check the process table, since the library must
# not see it.
wait_for "the compositor elsewhere to be up" \
  is_marked "$ELSEWHERE" 999998:1
expect "a compositor in another runtime directory is none of this one's business" \
  0 alive
expect "not even by name" 0 alive 999998:1
kill -KILL "$ELSEWHERE" 2>/dev/null
rm -rf "$ELSEWHERE_DIR"

# --- one that will not take SIGTERM ------------------------------------------

# A compositor that ignores SIGTERM would hang the job, so the second pass
# (SIGKILL) is required.
a_compositor "$MINE" 'trap "" TERM; sleep 300'
SAID="$(kill_compositors "$MINE" 2>&1)"
expect "one that ignores SIGTERM is killed anyway" 0 alive "$MINE"
says "and is named as having needed it" 'would not take SIGTERM' "$SAID"


# --- the script this exists for ----------------------------------------------

# The cases above pass even if `under-wayland.sh` stops using the library.
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
