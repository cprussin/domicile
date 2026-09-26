#!/usr/bin/env bash
# Room for a release build, made rather than asked for, from the cheapest
# things first.
#
#   .github/scripts/engine-release-room.sh <chromium/src> out/Release <stage> <owner>
#
# RUN AFTER THE TREE LOCK IS TAKEN, NEVER BEFORE. Two of the things this
# removes are inside the run's own checkout, and deleting anything in there
# while another writer is in that tree is exactly the corruption
# engine-tree-lock.sh exists to prevent. The same goes for every other tree in
# the pool, which is why this takes each one's lock before it empties anything
# in it and passes over any it cannot take. See scripts/test-engine-release-room.sh.
#
# TWO THINGS IT NEVER TOUCHES. This run's own `$OUT`: deleting it is what
# turned run 36235996990 into a 4h20m cold build, and a refusal costs the next
# run nothing. And the compiler cache as a whole: it is trimmed by age, never
# cleared, because a cleared cache makes every tree's next build cold.
set -euo pipefail

# All four, with no defaults between them: the sibling scripts here default
# their output and stage directories and can afford to, because the worst a
# wrong guess costs them is a build in the wrong place. This one removes what
# it is pointed at, and a default is a guess about which directory that is.
CHROMIUM="${1:-}"
OUT="${2:-}"
STAGE="${3:-}"
OWNER="${4:-}"

if [ -z "$CHROMIUM" ] || [ -z "$OUT" ] || [ -z "$STAGE" ] || [ -z "$OWNER" ]; then
  echo "usage: $(basename "$0") <chromium/src> <out dir> <stage dir> <owner>" >&2
  exit 2
fi

# The tarball unpacked back into the checkout, which the workflow tests the
# packaged build out of. Derived rather than named, because it is the release
# output directory with a suffix and the two must not be able to drift.
STAGED="$OUT-staged"

# WHAT A BUILD WRITES, MEASURED ON `crux`, and not the "~40G" this used to
# assume, which was wrong by ~15x and made the old 60G floor delete warm builds
# to reach it:
#
#   out/Release, whole and cold                  1.9-2.8G
#   the compiler cache, whole (a cold build's    3.3-4G
#     misses are at most that)
#   this job's TMPDIR                            ~1.2G
#   the tarball and its unpacked copy            under 2.8G each: both are a
#                                                subset of out/Release
#
# ~13.6G at the top of every range, so 15G.
FLOOR_GB=15

# A temp directory is stale when it was made longer ago than any job on these
# runners can run: engine.yml's 1200 minutes is the longest budget, and a
# directory's ctime cannot be earlier than when it was made, so one whose
# ctime is a day old belongs to no job that is still alive — on this runner or
# the other one. scripts/test-engine-release-room.sh holds this against every
# workflow's `timeout-minutes`.
STALE_TMP_MINUTES=1440

# The pool, as engine-tree-pool.sh names it. A seam for the tests, which have
# no /build and should not want one.
BUILD_ROOT="${DOMICILE_BUILD_ROOT:-/build}"
TREES="$BUILD_ROOT/trees"
# The runner units' TMPDIR, which both of them share.
TMP="$BUILD_ROOT/tmp"
# Where the stage was before it moved into each tree. Nothing writes here now,
# and everything in it is an asset on a published release.
LEGACY_STAGE="$BUILD_ROOT/engine-release"
# A seam for the tests, which cannot age a directory's ctime.
NOW="${DOMICILE_NOW:-$(date +%s)}"
LOCK_SH="$(cd "$(dirname "$0")" && pwd)/engine-tree-lock.sh"
RECLAIMER="$OWNER, reclaiming disk"

# Whole gigabytes free on the dataset the checkout is on, as a bare number:
# `df` prints a header and a `54G`, and every comparison below wants the 54.
free_gb() { df -BG --output=avail "$CHROMIUM" | tail -1 | tr -dc '0-9'; }

# Measures again after a reclaim and says so, and exits the script when that
# was enough.
done_if_room() {
  free="$(free_gb)"
  echo "that leaves ${free}G free"
  if [ "$free" -ge "$FLOOR_GB" ]; then
    exit 0
  fi
}

# `rm -rf` that gets through what nix leaves read-only: a copy out of the
# store keeps the store's modes. What an earlier run already removed, or a
# glob that matched nothing, is skipped rather than handed to `chmod`.
remove() {
  local path
  for path in "$@"; do
    if [ -e "$path" ]; then
      chmod -R u+w "$path"
      rm -rf "$path"
    fi
  done
}

# What nix and these jobs made in the shared TMPDIR and nothing still alive can
# own. Only those names: anything else in there is not this script's to judge.
stale_tmp() {
  local entry
  for entry in "$TMP"/nix-shell.* "$TMP"/nix-develop.* "$TMP"/dj.*; do
    if [ -e "$entry" ] &&
      [ $((NOW - $(stat -c %Z "$entry"))) -gt $((STALE_TMP_MINUTES * 60)) ]; then
      printf '%s\n' "$entry"
    fi
  done
}

# Every OTHER tree, least recently handed out first: the order
# engine-tree-pool.sh gives trees away in, so what goes is what the pool would
# have overwritten soonest anyway. A tree never handed out has no timestamp and
# sorts oldest, which it is.
other_trees() {
  local own slot
  own="$(cd "$CHROMIUM/.." && pwd -P)"
  for slot in "$TREES"/*; do
    if [ -d "$slot/src" ] && [ "$(cd "$slot" && pwd -P)" != "$own" ]; then
      printf '%s %s\n' "$(stat -c %Y "$slot/.domicile-last-used" 2>/dev/null || echo 0)" "$slot"
    fi
  done | LC_ALL=C sort -n | cut -d' ' -f2-
}

free="$(free_gb)"
echo "$CHROMIUM has ${free}G free; a build needs a floor of ${FLOOR_GB}G"

if [ "$free" -ge "$FLOOR_GB" ]; then
  exit 0
fi

# 1. WHAT NIX LEAKED, which is where the space was: 82G of /build/tmp on the
# day this was measured. See engine-job-tmp.sh for why it leaks.
mapfile -t stale < <(stale_tmp)
if [ "${#stale[@]}" -gt 0 ]; then
  echo "short, so temp directories older than any job go:"
  printf '  %s\n' "${stale[@]}"
  remove "${stale[@]}"
  done_if_room
fi

# 2. TARBALLS OF RELEASES ALREADY PUBLISHED: where the stage used to be, and
# this run's own stage, which packaging writes again.
echo "still short, so tarballs of releases already published go:"
echo "  $LEGACY_STAGE/domicile-engine-*"
echo "  $STAGE"
remove "$LEGACY_STAGE"/domicile-engine-* "$STAGE"
done_if_room

# 3. THIS RUN'S UNPACKED TARBALL, which the guard step deletes and writes again.
echo "still short, so last run's unpacked tarball goes:"
echo "  $CHROMIUM/$STAGED"
remove "$CHROMIUM/$STAGED"
done_if_room

# 4. THE SAME TWO IN EVERY TREE NOBODY HOLDS, under that tree's lock so no run
# can start packaging in it halfway through. A held tree is another run's and
# is passed over, however old.
for slot in $(other_trees); do
  if { [ -e "$slot/engine-release" ] || [ -e "$slot/src/$STAGED" ]; } &&
    "$LOCK_SH" take "$slot/src" "$RECLAIMER" >/dev/null 2>&1; then
    echo "still short, so ${slot##*/}'s tarballs and unpacked tarball go"
    remove "${slot:?}/engine-release" "${slot:?}/src/$STAGED"
    "$LOCK_SH" drop "$slot/src" "$RECLAIMER" >/dev/null
    done_if_room
  fi
done

# 5. COMPILER CACHE ENTRIES NOBODY HAS USED IN A WEEK. Safe to trim under a
# build that is using it.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  echo "still short, so compiler cache entries unused for a week go"
  "$DOMICILE_CC_WRAPPER" --evict-older-than 7d
  done_if_room
fi

# 6. A TREE NOBODY HOLDS, ITS BUILD. It costs a rebuild only if a run wants
# that tree's pin again. Under its lock, and a held one is passed over.
for slot in $(other_trees); do
  if [ -d "$slot/src/$OUT" ] &&
    "$LOCK_SH" take "$slot/src" "$RECLAIMER" >/dev/null 2>&1; then
    echo "still short, so ${slot##*/}'s build goes: no run holds that tree,"
    echo "  and the next run that wants its pin rebuilds it"
    remove "${slot:?}/src/$OUT"
    "$LOCK_SH" drop "$slot/src" "$RECLAIMER" >/dev/null
    done_if_room
  fi
done

# 7. COMPILER CACHE ENTRIES NOBODY HAS USED TODAY. Today's stay: they are what
# the builds in flight are hitting.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  echo "still short, so compiler cache entries unused for a day go"
  "$DOMICILE_CC_WRAPPER" --evict-older-than 1d
  done_if_room
else
  echo "DOMICILE_CC_WRAPPER is unset, so there is no compiler cache to trim"
fi

# EVERYTHING NOBODY ELSE HOLDS IS ALREADY GONE, so what is left is another
# run's, this run's own build, or not a cache. The floor holds: a build that
# cannot finish must not start, because the failure hours in is a full dataset
# on the machine this repository's other work lives on.
{
  echo "::error::${free}G free after reclaiming, under a floor of ${FLOOR_GB}G"
  echo
  echo "This run has already dropped stale temp directories, published"
  echo "tarballs, every unpacked tarball and build in a tree no run holds,"
  echo "and compiler cache entries unused for a day. It keeps its own"
  echo "$CHROMIUM/$OUT, so the next run is still warm. What is holding the"
  echo "rest is not its to remove:"
  echo
  for slot in $(other_trees); do
    if [ -d "$slot/src/$OUT" ]; then
      echo "  $("$LOCK_SH" who "$slot/src")"
    fi
  done
  echo "  every checkout under $TREES, which is not a cache."
  echo
  echo "So this needs those runs to finish, or a person on the machine"
  echo "deciding what goes."
} >&2
exit 1
