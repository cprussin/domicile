#!/usr/bin/env bash
# Room for a release build, made rather than asked for.
#
#   .github/scripts/engine-release-room.sh <chromium/src> out/Release <stage> <owner>
#
# RUN AFTER THE TREE LOCK IS TAKEN, NEVER BEFORE. Two of the things this
# removes are inside the run's own checkout, and deleting anything in there
# while another writer is in that tree is exactly the corruption
# engine-tree-lock.sh exists to prevent. The same goes for every other tree in
# the pool, which is why this takes each one's lock before it empties it and
# passes over any it cannot take. See scripts/test-engine-release-room.sh.
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

# A non-component Chromium is ~40G of objects, and a cold build writes its
# misses into the compiler cache on the same dataset as it goes. 60 is those
# two with nothing to spare, and it is where reclaiming stops rather than
# where it starts: a run 2G short no longer fails, it empties one free tree.
FLOOR_GB=60

# The pool, as engine-tree-pool.sh names it. A seam for the tests, which have
# no /build and should not want one.
TREES="${DOMICILE_BUILD_ROOT:-/build}/trees"
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

# Every OTHER tree with a build in it, least recently handed out first: the
# order engine-tree-pool.sh gives trees away in, so the build that goes is the
# one the pool would have overwritten soonest anyway. A tree never handed out
# has no timestamp and sorts oldest, which it is.
other_builds() {
  local own slot
  own="$(cd "$CHROMIUM/.." && pwd -P)"
  for slot in "$TREES"/*; do
    if [ -d "$slot/src/$OUT" ] && [ "$(cd "$slot" && pwd -P)" != "$own" ]; then
      printf '%s %s\n' "$(stat -c %Y "$slot/.domicile-last-used" 2>/dev/null || echo 0)" "$slot"
    fi
  done | LC_ALL=C sort -n | cut -d' ' -f2-
}

free="$(free_gb)"
echo "$CHROMIUM has ${free}G free"

if [ "$free" -ge "$FLOOR_GB" ]; then
  exit 0
fi

# WHAT IS LEFT OVER, FIRST. Both of these are worth nothing the moment the
# run that made them ended, and neither costs this run a second to recreate:
# the stage directory holds the tarball of every release ever packaged here,
# each of which is already an asset on a GitHub release, and
# `out/Release-staged` is last run's tarball unpacked, which the guard step
# deletes and writes again anyway.
echo "under the ${FLOOR_GB}G floor, so this run is dropping what it owns"
echo "  $STAGE — tarballs of releases already published"
echo "  $CHROMIUM/$STAGED — last run's tarball, unpacked"
rm -rf "$STAGE" "$CHROMIUM/$STAGED"
done_if_room

# THEN A TREE NOBODY HOLDS. Its build costs a rebuild only if a run wants that
# tree's pin again, where this run's own costs one now. Its lock is taken for
# the delete, so no run can start building in it halfway through, and a tree
# whose lock is held is another run's and is passed over, however old.
for slot in $(other_builds); do
  if "$LOCK_SH" take "$slot/src" "$RECLAIMER" >/dev/null 2>&1; then
    echo "still short, so ${slot##*/}'s build goes: no run holds that tree,"
    echo "  and the next run that wants its pin rebuilds it"
    rm -rf "${slot:?}/src/$OUT" "${slot:?}/src/$STAGED"
    "$LOCK_SH" drop "$slot/src" "$RECLAIMER" >/dev/null
    done_if_room
  fi
done

# THEN THE COMPILER CACHE, which every tree shares and which only ever makes a
# build faster: entries nobody has used in a week, and then the rest. Cheaper
# than this run's own build, which is four hours; ccache is safe to trim under
# a build that is using it.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  echo "still short, so compiler cache entries unused for a week go"
  "$DOMICILE_CC_WRAPPER" --evict-older-than 7d
  done_if_room
  echo "still short, so the compiler cache is emptied"
  "$DOMICILE_CC_WRAPPER" --clear
  done_if_room
else
  echo "DOMICILE_CC_WRAPPER is unset, so there is no compiler cache to trim"
fi

# THEN THE ONE THAT COSTS THIS RUN SOMETHING, AND ONLY THEN. `$OUT` is this
# run's own build directory in a tree it holds, so it is this run's to drop —
# but dropping it turns a ~15m incremental build into a clean one, which is
# four hours on this machine. A run that takes four hours still publishes an
# engine; a run refused for want of space publishes nothing at all.
echo "still short, so the build cache goes too"
echo "  $CHROMIUM/$OUT — this run's objects, which costs this run a"
echo "  clean build: four hours rather than the usual few minutes"
rm -rf "$CHROMIUM/$OUT"
done_if_room

# EVERYTHING NOBODY ELSE HOLDS IS ALREADY GONE, so what is left is another
# run's or is not a cache. The floor holds: a build that cannot finish must
# not start, because the failure four hours in is a full dataset on the
# machine this repository's other work lives on.
{
  echo "::error::${free}G free after reclaiming; a release build needs ~40G and this will not fit"
  echo
  echo "This run has already dropped its stage directory, its unpacked"
  echo "tarball, every build in a tree no run holds, the compiler cache and"
  echo "its own build. What is holding the rest is not its to remove:"
  echo
  for slot in $(other_builds); do
    echo "  $("$LOCK_SH" who "$slot/src")"
  done
  echo "  every checkout under $TREES, which is not a cache."
  echo
  echo "So this needs those runs to finish, or a person on the machine"
  echo "deciding what goes."
} >&2
exit 1
