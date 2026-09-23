#!/usr/bin/env bash
# The tree lock's one job: never release a tree it did not take.
#
# The lock is what stands between a CI reset and a four-hour build running in
# the same checkout, and the failure it prevents is silent — a binary linked
# from two different trees, which nothing downstream looks for. So the parts
# that could quietly stop working are the parts worth a test: whether a second
# taker is actually refused, and whether the unconditional `drop` at the end of
# a job can be made to release somebody else's lock.
#
# The real script, out of `.github/scripts`, copied nowhere. `DOMICILE_TREE_LOCK`
# is its own test seam: without it the lock is beside the checkout, which on
# the machine that matters is `/build`, and a test has no business there.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_SH="$ROOT/.github/scripts/engine-tree-lock.sh"
[ -x "$LOCK_SH" ] || { echo "no $LOCK_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export DOMICILE_TREE_LOCK="$WORK/lock"
TREE="$WORK/chromium/src"
mkdir -p "$TREE"

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
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}
lock() { # subcommand, owner — status on stdout's first word, output after
  local out
  if out="$("$LOCK_SH" "$1" "$TREE" "${2:-}" 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }

expect "an unheld tree is taken" ok "$(status "$(lock take alice)")"
expect "a second taker is refused" refused "$(status "$(lock take bob)")"

held="$(lock take bob)"
contains "the refusal names who holds it" "'alice'" "$held"
contains "the refusal reports an age" "held for 0m" "$held"
contains "the refusal explains what a reset would do to a running build" \
  "two different trees" "$held"
# THE ONE COMMAND. A message that says a lock is stale and leaves the reader to
# work out where it is has explained the problem and not the fix, and the fix
# is one `rm` nobody should have to derive from a script they have not read.
contains "the refusal prints the command that clears a stale lock" \
  "rm -rf $WORK/lock" "$held"

# THE CASE THAT MAKES `drop` A CHECK RATHER THAN AN `rm`. Both workflows drop
# from an `if: always()` step, which runs on the path where *taking* the lock
# is what failed — so the losing run reaches `drop` while the winner is
# building. An unconditional remove there releases the tree in the middle of
# that build, which is the exact corruption the lock exists to prevent,
# arrived at through the lock.
lock drop bob >/dev/null
expect "a run that does not hold it cannot drop it" ok "$(status "$(lock who)")"
contains "and it is still alice's" "'alice'" "$(lock who)"

expect "the holder can drop it" ok "$(status "$(lock drop alice)")"
contains "and then nothing holds it" "is not locked" "$(lock who)"
expect "the tree can be taken again" ok "$(status "$(lock take carol)")"

# Dropping nothing is not a failure: the `always()` step also runs on the path
# where the job failed before the lock was ever taken.
lock drop carol >/dev/null
expect "dropping an unheld tree is a no-op, not an error" ok \
  "$(status "$(lock drop carol)")"

# AGE IS THE WHOLE POINT OF THE TIMESTAMP. "Taken at 04:12" answers a question
# nobody has; the question is whether to wait or to clear, and eleven hours is
# the answer to it.
lock take dave >/dev/null
echo "$(( $(date +%s) - 40200 ))" >"$WORK/lock/since"
contains "an old lock reads in hours and minutes" "held for 11h 10m" "$(lock who)"

# Three ways the timestamp can be unusable, and none of them may produce a
# confident wrong number: a lock reported as held for -3h is worse than one
# reported as unknown, because the first invites clearing it.
echo "not a number" >"$WORK/lock/since"
contains "a corrupt timestamp is unknown, not nonsense" "unknown age" "$(lock who)"
rm -f "$WORK/lock/since"
contains "a missing timestamp is unknown" "unknown age" "$(lock who)"
echo "$(( $(date +%s) + 9000 ))" >"$WORK/lock/since"
contains "a clock that moved backward is unknown, not negative" \
  "unknown age" "$(lock who)"

rm -f "$WORK/lock/owner"
contains "a lock with no name in it still refuses a taker" \
  "did not write their name" "$(lock take erin)"
# And nobody can claim it by guessing the empty name: `drop` compares what is
# in the lock, and an unnamed lock matches nothing.
lock drop "" >/dev/null 2>&1
expect "an unnamed lock is not droppable by an empty owner" ok \
  "$(status "$(lock who)")"
contains "so it is still there to be cleared by hand" "is locked by" "$(lock who)"

# ONE LOCK PER TREE, AND THE PATH IS RESOLVED TO FIND IT.
#
# This used to put the lock beside the checkout -- `dirname` of
# `/build/chromium/src` -- and then at the build root for the whole pool, when
# that path became a symlink `engine-tree-pool.sh` swapped between trees. CI no
# longer swaps it: the pool hands each run its own tree's path, so two runs in
# two different trees are the ordinary case and one lock for the pool would
# serialize them for no reason.
#
# What has to hold instead is that the name is derived from the TREE and not
# from the path typed, so a person building through `/build/chromium/src` and a
# job building through `/build/trees/tree-0/src` collide when they should.
unset DOMICILE_TREE_LOCK
POOL="$WORK/pool"
mkdir -p "$POOL/trees/tree-0/src" "$POOL/trees/tree-1/src"
ln -s "$POOL/trees/tree-0" "$POOL/chromium"
export DOMICILE_BUILD_ROOT="$POOL"

DOMICILE_BUILD_ROOT="$POOL" "$LOCK_SH" take "$POOL/chromium/src" frank >/dev/null 2>&1
expect "the lock is at the build root, not inside the tree it names" ok \
  "$([ -d "$POOL/.domicile-tree-lock-tree-0" ] && echo ok || echo "it is not there")"
expect "so nothing that moves the tree can strand it" ok \
  "$([ ! -e "$POOL/trees/tree-0/.domicile-tree-lock" ] && echo ok || echo "it went into the tree")"

# THE CASE THE PER-TREE NAME EXISTS FOR. The convenience path and the real path
# are the same tree, so the second take must be refused -- otherwise a person
# and a job compile in one tree at once and siso links a binary from both.
out="$(DOMICILE_BUILD_ROOT="$POOL" "$LOCK_SH" take "$POOL/trees/tree-0/src" gail 2>&1 || true)"
expect "the real path and the convenience path are one tree" refused \
  "$(case "$out" in (*locked*) echo refused ;; (*) echo "$out" ;; esac)"

# And the tree nobody is in is free, which is the whole point of per-tree.
expect "a different tree is free while that one is held" ok \
  "$(DOMICILE_BUILD_ROOT="$POOL" "$LOCK_SH" take "$POOL/trees/tree-1/src" gail >/dev/null 2>&1 && echo ok || echo "refused")"

DOMICILE_BUILD_ROOT="$POOL" "$LOCK_SH" drop "$POOL/trees/tree-0/src" frank >/dev/null 2>&1
expect "and a drop through the real path releases what the link took" ok \
  "$([ ! -e "$POOL/.domicile-tree-lock-tree-0" ] && echo ok || echo "still held")"
expect "without releasing the other tree" ok \
  "$([ -d "$POOL/.domicile-tree-lock-tree-1" ] && echo ok || echo "it released both")"
unset DOMICILE_BUILD_ROOT

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
