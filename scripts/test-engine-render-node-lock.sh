#!/usr/bin/env bash
# What keeps two runners off one card, asserted.
#
# `crux` grew a second job slot so that the every-pull-request guard would stop
# queueing behind Chromium builds. That slot is worth hours a day and it costs
# one thing: the single slot used to be an accidental lock over the render
# node, and `guard-latency.sh` times sixty keystroke-to-pixel rounds against
# it. A second job on the card during those rounds is indistinguishable from
# the regression the guard exists to catch.
#
# `.github/scripts/engine-render-node-lock.sh` is what replaces the accident
# with something deliberate, and the three things it has to get right are the
# three ways a lock between two runners goes wrong:
#
# - **It waits.** The tree lock refuses instead, because on a one-slot machine
#   a run that waits is a run already holding the slot its holder needs. Two
#   slots retire that argument, and a lock that refused here would turn every
#   overlap into a red check.
# - **It gives up rather than waiting forever**, because a wait with no bound
#   is a job that holds a runner until the timeout GitHub imposes.
# - **It clears a lock nothing will come back for.** A canceled run is the
#   ordinary way this leaks and `pinned-engine.yml` cancels superseded runs, so
#   a lock only a person could clear would wedge the every-PR job within a day.
#   This is the rule the TREE lock deliberately does not have, and the reason
#   the two differ is the cost of guessing wrong: a guard that has to be re-run
#   against a reset that lands inside somebody's four-hour build.
#
# And the one that is not about waiting at all: a drop only drops what it owns.
# The workflow drops this in an `if: always()` step, which is reached by a run
# that never took the lock, and an unconditional `rm` there hands the card to a
# third job in the middle of the holder's timed guard.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_SH="$ROOT/.github/scripts/engine-render-node-lock.sh"
[ -x "$LOCK_SH" ] || { echo "no $LOCK_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export DOMICILE_RENDER_NODE_LOCK="$WORK/lock"
export DOMICILE_RENDER_NODE_NOISE="$WORK/noise"
export DOMICILE_RENDER_NODE_POLL=1

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    fail "$1" "wanted: $2
    got:    $3"
  fi
}
contains() { # what, needle, haystack
  case "$3" in
    (*"$2"*) ok "$1" ;;
    (*) fail "$1" "expected to mention: $2
    said: $3" ;;
  esac
}

# Status on the first line, output after it, so a case can assert on either
# without running the script twice.
run() {
  local out status
  out="$("$LOCK_SH" "$@" 2>&1)"
  status=$?
  printf '%s\n%s\n' "$status" "$out"
}
status_of() { printf '%s\n' "$1" | head -1; }
output_of() { printf '%s\n' "$1" | tail -n +2; }

# --- a free card -------------------------------------------------------------

r="$(run take engine-run-1)"
expect "taking a free render node succeeds" 0 "$(status_of "$r")"
contains "and says who took it" "engine-run-1" "$(output_of "$r")"
expect "and the lock records its owner" "engine-run-1" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

r="$(run who)"
contains "who names the holder" "engine-run-1" "$(output_of "$r")"

# --- a card somebody else has ------------------------------------------------

# THE WAIT IS BOUNDED, and this is the assertion that says so. A zero budget
# makes the first refusal the last one, which is the same code path a real
# twenty-minute wait ends on and takes no time to run.
r="$(DOMICILE_RENDER_NODE_MAX_WAIT=0 run take engine-run-2)"
expect "a held render node is not taken from under its owner" 1 "$(status_of "$r")"
contains "and the failure names who has it" "engine-run-1" "$(output_of "$r")"
contains "and says how to clear it by hand" "rm -rf" "$(output_of "$r")"
expect "and the owner is unchanged" "engine-run-1" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

# --- a drop that is not the holder's -----------------------------------------

# The `if: always()` case: a step that failed to take the lock still reaches the
# drop. It must not clear somebody else's.
r="$(run drop engine-run-2)"
expect "a non-owner's drop is not an error" 0 "$(status_of "$r")"
contains "and it says whose the lock is" "engine-run-1" "$(output_of "$r")"
expect "and it leaves the lock alone" "engine-run-1" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

# --- the owner's drop --------------------------------------------------------

r="$(run drop engine-run-1)"
expect "the owner's drop succeeds" 0 "$(status_of "$r")"
if [ -d "$WORK/lock" ]; then
  fail "the owner's drop clears the lock" "$WORK/lock is still there"
else
  ok "the owner's drop clears the lock"
fi

r="$(run drop engine-run-1)"
expect "dropping a lock nobody holds is not an error" 0 "$(status_of "$r")"

r="$(run who)"
contains "who says so when the card is free" "nobody" "$(output_of "$r")"

# --- a lock nothing is coming back for ---------------------------------------

# THE CASE THE TREE LOCK REFUSES TO HANDLE, and the reason this one does is in
# both headers: a canceled run leaves this behind, `pinned-engine.yml` cancels
# superseded runs, and the cost of clearing it wrongly is a re-run rather than
# a build compiled from two trees.
"$LOCK_SH" take engine-that-was-canceled >/dev/null 2>&1
r="$(DOMICILE_RENDER_NODE_STALE_AFTER=0 run take engine-run-3)"
expect "a lock older than any guard could hold it is taken" 0 "$(status_of "$r")"
contains "and taking it is said out loud" "::warning::" "$(output_of "$r")"
contains "and the warning names who left it" "engine-that-was-canceled" \
  "$(output_of "$r")"
expect "and the new owner has it" "engine-run-3" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

# A lock is stolen once per `take` and not in a loop: the second refusal after a
# steal is a real holder that arrived in between, and spinning on it would hand
# the card to whoever asks most often.
"$LOCK_SH" drop engine-run-3 >/dev/null 2>&1

# --- a timestamp that cannot be read -----------------------------------------

# A lock from the future is a clock that moved, and a lock with no timestamp is
# one this script did not write. Neither is evidence of abandonment, so neither
# is stolen -- otherwise the one thing that reliably clears a lock is corrupting
# the file that says how old it is.
"$LOCK_SH" take engine-run-4 >/dev/null 2>&1
echo "not-a-number" >"$WORK/lock/since"
r="$(DOMICILE_RENDER_NODE_STALE_AFTER=0 DOMICILE_RENDER_NODE_MAX_WAIT=0 run take engine-run-5)"
expect "a lock with an unreadable age is not stolen" 1 "$(status_of "$r")"
expect "and its owner keeps it" "engine-run-4" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

date -d '+1 hour' +%s >"$WORK/lock/since" 2>/dev/null ||
  echo $(($(date +%s) + 3600)) >"$WORK/lock/since"
r="$(DOMICILE_RENDER_NODE_STALE_AFTER=0 DOMICILE_RENDER_NODE_MAX_WAIT=0 run take engine-run-6)"
expect "a lock timestamped in the future is not stolen" 1 "$(status_of "$r")"
expect "and its owner keeps it too" "engine-run-4" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"
rm -rf "$WORK/lock"

# --- a quiet machine ---------------------------------------------------------

# WHAT THE CARD ALONE DID NOT BUY. Main run 36226737213 held the card and its
# latency guard read a floor of 44.61 ms, commit to pixel 49.04 ms, while run
# 36228817911 compiled Chromium on the other runner. Quiet runs read 19-29 ms.
# So the timed guard asks for the machine, not only the card: compiles and
# guards register as noise with `noisy`, and `quiet` takes the card only when
# there is none.
noise_count() {
  find "$WORK/noise" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' '
}
until_noise() { # up to 5s for a registration to appear
  local n=0
  while [ "$(noise_count)" -eq 0 ] && [ "$n" -lt 50 ]; do
    sleep 0.1; n=$((n + 1))
  done
}

r="$(run noisy build-1 -- sh -c 'cat "$DOMICILE_RENDER_NODE_NOISE"/*/owner; exit 3')"
expect "noise runs its command and hands back its status" 3 "$(status_of "$r")"
contains "and the command runs registered under its owner" "build-1" "$(output_of "$r")"
expect "and the registration goes when the command does" 0 "$(noise_count)"

r="$(run quiet latency-1)"
expect "a quiet machine's card is taken" 0 "$(status_of "$r")"
expect "and held by the measurement" "latency-1" \
  "$(cat "$WORK/lock/owner" 2>/dev/null)"

# Noise does not start inside somebody's measurement.
r="$(DOMICILE_RENDER_NODE_MAX_WAIT=0 run noisy build-2 -- touch "$WORK/build-2-ran")"
expect "noise does not run beside a measurement" 1 "$(status_of "$r")"
contains "and says whose measurement" "latency-1" "$(output_of "$r")"
if [ -e "$WORK/build-2-ran" ]; then
  fail "and its command never ran" "it ran"
else
  ok "and its command never ran"
fi
expect "and it leaves no registration behind" 0 "$(noise_count)"

# It waits instead, and goes ahead once the measurement is over.
DOMICILE_RENDER_NODE_MAX_WAIT=20 \
  "$LOCK_SH" noisy build-3 -- touch "$WORK/build-3-ran" >/dev/null 2>&1 &
waiting=$!
sleep 2
if [ -e "$WORK/build-3-ran" ]; then
  fail "noise that arrives mid-measurement holds off" "it ran beside latency-1"
else
  ok "noise that arrives mid-measurement holds off"
fi
"$LOCK_SH" drop latency-1 >/dev/null 2>&1
wait "$waiting"
expect "and runs once the measurement drops the card" 0 "$?"
if [ -e "$WORK/build-3-ran" ]; then ok "and its command ran"; else
  fail "and its command ran" "no $WORK/build-3-ran"
fi

# No measurement beside noise, and failing to get one is "did not run" (77),
# which STRICT makes a failure: not a pass, and not a regression either. The
# noise outlives the stale bound by then, so this also says the heartbeat keeps
# a live registration live.
DOMICILE_RENDER_NODE_NOISE_BEAT=1 DOMICILE_RENDER_NODE_NOISE_STALE=2 \
  "$LOCK_SH" noisy build-4 -- \
  sh -c "sleep 5; date +%s.%N >'$WORK/build-4-ended'" >/dev/null 2>&1 &
noisy_pid=$!
until_noise
sleep 3
r="$(DOMICILE_RENDER_NODE_NOISE_STALE=2 DOMICILE_RENDER_NODE_QUIET_WAIT=0 \
  run quiet latency-2)"
expect "no measurement is taken beside noise" 77 "$(status_of "$r")"
contains "and it says it did not run" "SKIP:" "$(output_of "$r")"
contains "and names the noise" "build-4" "$(output_of "$r")"
if [ -d "$WORK/lock" ]; then
  fail "and it leaves the card free" "held by $(cat "$WORK/lock/owner" 2>/dev/null)"
else
  ok "and it leaves the card free"
fi

r="$(DOMICILE_RENDER_NODE_NOISE_STALE=2 DOMICILE_RENDER_NODE_QUIET_WAIT=30 \
  run quiet latency-3)"
took="$(date +%s.%N)"
expect "a measurement waits the noise out" 0 "$(status_of "$r")"
ended="$(cat "$WORK/build-4-ended" 2>/dev/null || echo 0)"
if awk "BEGIN { exit !($ended > 0 && $took >= $ended) }"; then
  ok "and takes the card only after it ended"
else
  fail "and takes the card only after it ended" "ended $ended, took $took"
fi
wait "$noisy_pid"
"$LOCK_SH" drop latency-3 >/dev/null 2>&1

# A card somebody else holds is waited for too.
"$LOCK_SH" take pinned-1 >/dev/null 2>&1
r="$(DOMICILE_RENDER_NODE_QUIET_WAIT=0 run quiet latency-4)"
expect "a measurement does not take a card somebody holds" 77 "$(status_of "$r")"
contains "and names who holds it" "pinned-1" "$(output_of "$r")"
"$LOCK_SH" drop pinned-1 >/dev/null 2>&1

# --- noise nothing is keeping alive ------------------------------------------

# A registration whose heartbeat stopped is a run that was killed. Waiting on it
# would make every measurement after it a skip.
mkdir -p "$WORK/noise/abandoned"
echo "engine-run-that-was-killed" >"$WORK/noise/abandoned/owner"
echo $(($(date +%s) - 3600)) >"$WORK/noise/abandoned/since"
r="$(DOMICILE_RENDER_NODE_QUIET_WAIT=0 run quiet latency-5)"
expect "noise with no heartbeat does not hold off a measurement" 0 "$(status_of "$r")"
contains "and clearing it is said out loud" "::warning::" "$(output_of "$r")"
contains "and names who left it" "engine-run-that-was-killed" "$(output_of "$r")"
"$LOCK_SH" drop latency-5 >/dev/null 2>&1

# And the heartbeat stops with the wrapper it speaks for: one killed outright
# never reaches its own cleanup.
DOMICILE_RENDER_NODE_NOISE_BEAT=1 "$LOCK_SH" noisy build-5 -- \
  sh -c "echo \$\$ >'$WORK/build-5-pid'; exec sleep 30" >/dev/null 2>&1 &
killed=$!
until_noise
kill -9 "$killed"
wait "$killed" 2>/dev/null
n=0
while [ "$(noise_count)" -gt 0 ] && [ "$n" -lt 50 ]; do
  sleep 0.1; n=$((n + 1))
done
expect "a killed wrapper's registration goes with it" 0 "$(noise_count)"
kill "$(cat "$WORK/build-5-pid")" 2>/dev/null

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
