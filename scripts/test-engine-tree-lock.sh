#!/usr/bin/env bash
# Asserts the tree lock refuses a second taker and never releases a tree its
# caller did not take.
#
# The lock keeps a CI reset out of a checkout that a long build is using.
# Without it, the build silently links a binary from two trees.
#
# `DOMICILE_TREE_LOCK` relocates the lock; by default it lives under `/build`.
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
# The refusal prints the exact `rm` that clears a stale lock.
contains "the refusal prints the command that clears a stale lock" \
  "rm -rf $WORK/lock" "$held"

# Both workflows drop from an `if: always()` step, which also runs when taking
# the lock failed. A losing run then reaches `drop` while the winner builds, so
# `drop` must check the owner.
lock drop bob >/dev/null
expect "a run that does not hold it cannot drop it" ok "$(status "$(lock who)")"
contains "and it is still alice's" "'alice'" "$(lock who)"

# `holds` checks whether a job still has a tree it did not take itself.
# engine.yml takes the tree in its build job and checks against it in the
# next job.
expect "the holder holds it" ok "$(status "$(lock holds alice)")"
expect "somebody else does not" refused "$(status "$(lock holds bob)")"
contains "and is told who does" "'alice'" "$(lock holds bob)"

expect "the holder can drop it" ok "$(status "$(lock drop alice)")"
expect "a tree nobody holds is held by nobody" refused "$(status "$(lock holds alice)")"
contains "and then nothing holds it" "is not locked" "$(lock who)"
expect "the tree can be taken again" ok "$(status "$(lock take carol)")"

# The `always()` step also runs when the job failed before taking the lock.
lock drop carol >/dev/null
expect "dropping an unheld tree is a no-op, not an error" ok \
  "$(status "$(lock drop carol)")"

# Age decides whether to wait or clear a lock, so the output shows age, not
# the time it was taken.
lock take dave >/dev/null
echo "$(( $(date +%s) - 40200 ))" >"$WORK/lock/since"
contains "an old lock reads in hours and minutes" "held for 11h 10m" "$(lock who)"

# An unusable timestamp reads as unknown age. A wrong number such as -3h could
# lead someone to clear a live lock.
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
# `drop` compares the stored owner, so an empty owner cannot drop an unnamed
# lock.
lock drop "" >/dev/null 2>&1
expect "an unnamed lock is not droppable by an empty owner" ok \
  "$(status "$(lock who)")"
contains "so it is still there to be cleared by hand" "is locked by" "$(lock who)"

# One lock per tree, named from the resolved tree path. The pool gives each
# run its own tree, so runs in different trees must not block each other. A
# person building through `/build/chromium/src` and a job building through
# `/build/trees/tree-0/src` must collide.
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

# The symlinked path and the real path are the same tree, so the second take
# is refused. Otherwise two builds compile in one tree at once.
out="$(DOMICILE_BUILD_ROOT="$POOL" "$LOCK_SH" take "$POOL/trees/tree-0/src" gail 2>&1 || true)"
expect "the real path and the convenience path are one tree" refused \
  "$(case "$out" in (*locked*) echo refused ;; (*) echo "$out" ;; esac)"

# A different tree stays free.
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
