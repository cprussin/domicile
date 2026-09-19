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

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
