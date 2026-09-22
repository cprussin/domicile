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
#
# AND A CHECK THAT ASKS BEFORE THE MACHINE HAS ANSWERED IS A FINDING ABOUT THE
# MACHINE. Every count here used to be taken the instant it was wanted, behind
# waits that gave up without saying they had: a fixture that stood three
# processes up or did not, and a `wait` on a disowned pid, which is answered at
# once and with a 0. On a busy container that printed `wanted: 3 / got: 0` and
# a sweep that said nothing — findings against a library that was doing exactly
# what it should, on a run that passed twice more the same hour, which is the
# most expensive shape a check has. So each assertion now carries the wait for
# the thing it is about, and the waits that belong to no assertion say what
# never happened and stop.
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
# And `children`, because waiting for a fixture to be up is asked of the
# process table rather than of the library — see `a_compositor`. A kernel built
# without it would answer "not yet" forever, which is a check that hangs rather
# than one that runs.
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

# This script standing in for one under-wayland.sh run, named the way the
# library names one.
MINE="$(compositor_owner)"

# How long anything below waits for the machine to do what it was asked.
#
# IT IS A NUMBER FOR ENDING A HANG, NOT ONE ANYTHING IS MEASURED AGAINST, so it
# is generous on purpose. Measured on a container at a load of forty-five, with
# three cargo builds on four cores: the worst wait for a bookkeeper to fork its
# two children was 0.12s and the worst for a killed starter to leave the
# process table was 0.06s. Thirty seconds is two hundred times either, and
# whatever does not happen inside it was never going to.
PATIENCE=30

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }

# An assertion and the wait for what it is about, in one. It takes the command
# that answers the question rather than an answer, and goes on asking until the
# answer is the one wanted.
#
# THE WAIT BELONGS TO THE ASSERTION, which is why it is in here rather than on
# the line above each call. A count of processes taken the instant after a kill
# is a count of a machine mid-kill, and one taken the instant after a spawn is
# a count of a machine that has not got round to it. Neither is a verdict on
# the library, and both read as one. Nothing is loosened by asking again: a
# number that is wrong because the library is wrong is still wrong thirty
# seconds later, and what gets reported is the last answer rather than the
# first.
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

# Waiting for a fixture to be up, and ending the run naming what never happened
# rather than going on without it.
#
# A BOUNDED WAIT THAT GIVES UP QUIETLY IS WORSE THAN NO WAIT AT ALL. The one
# that used to sit inside `a_compositor` gave a machine five seconds to start
# three processes and then returned as though it had. Every case after it was
# then about a compositor that was not there, and what a loaded container
# printed was `wanted: 3 / got: 0` twice and a sweep that said nothing — three
# findings against the library, not one of them about the library, on a run
# that passed twice more that hour. A fixture this cannot wait out is this
# script standing its own scenery up, and it has to say so in those words.
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

# A bookkeeper and the two processes it forks, all three carrying the marker —
# the shape of dbus-run-session, dbus-daemon and sway. $1 is the pid the
# compositor is to be recorded as belonging to; $2, when given, is a shell
# snippet the children run instead of waiting quietly.
#
# The bookkeeper's pid comes back in `BOOKKEEPER` rather than on stdout, so
# that nothing has to call this in a `$(...)`. That is a subshell: the give-up
# below would end it and nothing else, and `SPAWNED` would go back to what it
# was on the way out, taking the pid out of the trap's reach.
a_compositor() { # owner [what the children do]
  local owner="$1" children="${2:-sleep 300}"
  env DOMICILE_COMPOSITOR="$owner" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    bash -c "$children & $children & wait" >/dev/null 2>&1 &
  BOOKKEEPER=$!
  # Off the job table, so that the shell does not narrate each kill below;
  # the trap still has the pid.
  disown "$BOOKKEEPER"
  SPAWNED="$SPAWNED $BOOKKEEPER"
  # ASKED OF THE PROCESS TABLE AND NOT OF THE LIBRARY. What is waited for here
  # is the machine having got round to the fork, and `compositor_pids` finding
  # the three is the thing the case below asserts — so waiting on the answer to
  # that would be waiting for the assertion to pass, and an assertion that
  # cannot fail is what this file's own comments are about.
  wait_for "the compositor for $owner to have forked its two children" \
    has_forked "$BOOKKEEPER" 2
  # THE TRAP TAKES WHAT A SWEEP HAS NOT GOT TO YET. Every case here ends with
  # the compositor swept, so on the way through this adds nothing — but the
  # run can now stop between this fork and that sweep, because `wait_for` ends
  # it, and a bookkeeper killed on the way out orphans two `sleep`s that then
  # outlive the check by five minutes.
  SPAWNED="$SPAWNED $(children_of "$BOOKKEEPER")"
}

# Whether a shell has forked what it is waiting on yet, from the one file that
# says so without a scan.
has_forked() { # pid, how many
  [ "$(printf '%s\n' "$(children_of "$1")" | wc -w)" = "$2" ]
}

children_of() { # pid
  { cat "/proc/$1/task/$1/children"; } 2>/dev/null
}

# Whether a process is yet the compositor it was started to be. Its own
# environ, for the reason the library reads environs: it is what a process was
# exec'd with, so it says the marker is there only once the exec has happened.
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

# 999999:1 is a run that cannot be: no process holds that pid here, and none
# started one clock tick after boot. It stands in for another run's compositor
# throughout — what a sweep by name must not reach.
a_compositor "$MINE"
a_compositor 999999:1
kill_compositors "$MINE" >/dev/null 2>&1
expect "this run's compositor is gone" 0 alive "$MINE"
expect "and another run's is untouched" 3 alive 999999:1
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
wait_for "the second run to publish the name it gave itself" \
  test -s "$TOKEN_FILE"
# AND THE ONE PROCESS HERE NOTHING WAS EVER GOING TO COLLECT. The starter is a
# run and not a compositor, so its `sleep` carries no marker and no sweep by
# name or by leftover will ever reach it; the trap only knew the starter
# itself. Killing the starter below therefore orphaned it, once per run, to
# sleep out its five minutes — which is what `Terminate orphan process: pid
# (...) (sleep)` was in three jobs' post-step cleanup, and a step does not end
# while something it started still holds its output open.
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
# NOT `wait`, WHICH DOES NOT WAIT HERE. The starter was disowned, and `wait` on
# a pid that is no longer a job of this shell answers at once — with 0, so
# there is not even a status to notice it by. What that left was this case
# asking whether a compositor is leftover while the run that owns it was still
# being killed, and the honest answer to that is the one the library gave:
# no, and its sweep then spared the compositor, and three cases below this said
# so. What the case is about is a starter that is *gone*, so that is what is
# waited for — gone from the process table rather than merely sent a signal,
# because until it has been reaped its pid is still held and still its own.
wait_for "the starter to be gone" test ! -e "/proc/$STARTER"
expect "once the starter is gone its compositor is leftover" 3 alive
SAID="$(kill_compositors 2>&1)"
expect "and the sweep takes it" 0 alive "$THEIRS"
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
# NOT AN INTERVAL, BECAUSE A PROCESS THAT HAS NOT STARTED IS ALSO ONE THE
# SWEEP FINDS NOTHING OF. Both assertions below are that a compositor somewhere
# else is missed, and both of them pass against a machine that has not got
# round to starting it — so they are worth exactly the wait that puts something
# there to miss. Read out of the process table, because the whole point of this
# one is that the library cannot see it.
wait_for "the compositor elsewhere to be up" \
  is_marked "$ELSEWHERE" 999998:1
expect "a compositor in another runtime directory is none of this one's business" \
  0 alive
expect "not even by name" 0 alive 999998:1
kill -KILL "$ELSEWHERE" 2>/dev/null
rm -rf "$ELSEWHERE_DIR"

# --- one that will not take SIGTERM ------------------------------------------

# A hang here is a job that never ends, which is worse than the leak, so the
# second pass is not optional.
a_compositor "$MINE" 'trap "" TERM; sleep 300'
SAID="$(kill_compositors "$MINE" 2>&1)"
expect "one that ignores SIGTERM is killed anyway" 0 alive "$MINE"
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
