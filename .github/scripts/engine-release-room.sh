#!/usr/bin/env bash
# Room for a release build, made rather than asked for.
#
#   .github/scripts/engine-release-room.sh /build/trees/tree-0/src out/Release /build/trees/tree-0/engine-release
#
# RUN AFTER THE TREE LOCK IS TAKEN, NEVER BEFORE. Two of the three things
# this removes are inside the shared checkout, and deleting anything in there
# while another writer is in that tree is exactly the corruption
# engine-tree-lock.sh exists to prevent. See .github/workflows/engine-release.yml.
#
# ONLY THIS TREE. The other tree's litter is reclaimable too, but only under
# its lock, and holding that lock even for the length of an `rm` is a window in
# which the other runner's `engine-tree-pool.sh pick` finds every tree held and
# refuses. A few gigabytes of tarballs are not worth a red run on the other
# runner; the refusal below names them for a person instead.
set -euo pipefail

# All three, with no defaults between them: the sibling scripts here default
# their output and stage directories and can afford to, because the worst a
# wrong guess costs them is a build in the wrong place. This one removes what
# it is pointed at, and a default is a guess about which directory that is.
CHROMIUM="${1:-}"
OUT="${2:-}"
STAGE="${3:-}"

if [ -z "$CHROMIUM" ] || [ -z "$OUT" ] || [ -z "$STAGE" ]; then
  echo "usage: $(basename "$0") <chromium/src> <out dir> <stage dir>" >&2
  exit 2
fi

# /build on `crux`, whose top level the refusal lists. A seam for the same
# reason as in engine-tree-pool.sh: the tests have no /build.
BUILD_ROOT="${DOMICILE_BUILD_ROOT:-/build}"
# Where this tree's siblings are: the pool hands out `<trees>/<slot>/src`.
TREES="$(dirname "$(dirname "$CHROMIUM")")"

# The tarball unpacked back into the checkout, which the workflow tests the
# packaged build out of. Derived rather than named, because it is the release
# output directory with a suffix and the two must not be able to drift.
STAGED="$OUT-staged"

# A non-component Chromium is ~40G of objects, and a cold build is that much
# new disk. The floor is that plus 20G that stays free when it finishes: the
# failure four hours in is a full dataset, and this is also where the
# machine's interactive builds live.
COLD_GB=40
FLOOR_GB=60

# Whole gigabytes free on the dataset the checkout is on, as a bare number:
# `df` prints a header and a `54G`, and every comparison below wants the 54.
free_gb() { df -BG --output=avail "$CHROMIUM" | tail -1 | tr -dc '0-9'; }

# Whole gigabytes already in this tree's build directory, rounded down.
out_gb() {
  if [ -d "$CHROMIUM/$OUT" ]; then
    echo $(($(du -sk "$CHROMIUM/$OUT" | cut -f1) / 1048576))
  else
    echo 0
  fi
}

free="$(free_gb)"
echo "$CHROMIUM has ${free}G free"
if [ "$free" -ge "$FLOOR_GB" ]; then
  exit 0
fi

# WHAT A WARM BUILD DIRECTORY IS WORTH: the space the build writes over rather
# than beside. Objects are named for their sources, so a rebuild — a new
# series, even a new pin — replaces them in place, and a cold build needs only
# what the directory does not already hold. Capped at a cold build, because an
# out/Release bigger than that is objects no build of this series rewrites.
#
# THIS DOES NOT LOWER THE FLOOR. Free plus this, against 60, is the same
# promise the bare 60 made for an empty tree: at most ~40G more is written, so
# 20G is left when the build is done. What it stops is judging a build that
# rewrites a few hundred objects as though it needed 40G of new ones — which
# refused run 36229767471 with 52G free beside a warm out/Release.
#
# Measured once, and only when `df` alone falls short: `du` over 40G of
# objects is not free, and nothing below writes into it.
held="$(out_gb)"
reused=$((held < COLD_GB ? held : COLD_GB))
echo "counting the ${reused}G already in $CHROMIUM/$OUT, which the build writes over: $((free + reused))G of the ${FLOOR_GB}G it needs"
if [ $((free + reused)) -ge "$FLOOR_GB" ]; then
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

free="$(free_gb)"
echo "that leaves ${free}G free, $((free + reused))G with $OUT"
if [ $((free + reused)) -ge "$FLOOR_GB" ]; then
  exit 0
fi

# THEN THE ONE THAT COSTS SOMETHING, AND ONLY WHEN IT GIVES SOMETHING BACK.
# Dropping `$OUT` frees what it holds and a cold build writes 40G straight
# back, so below 40G it moves the shortfall rather than closing it — and costs
# a four-hour rebuild to do so. Over 40G, the excess is objects no build of
# this series writes again, and dropping is the only way to get it back.
if [ $((free + held)) -ge "$FLOOR_GB" ]; then
  echo "still short, and $OUT holds ${held}G where a clean build is ~${COLD_GB}G, so it goes"
  echo "  $CHROMIUM/$OUT — this workflow's objects, which costs this run a"
  echo "  clean build: four hours rather than the usual few minutes"
  rm -rf "${CHROMIUM:?}/$OUT"
  free="$(free_gb)"
  echo "that leaves ${free}G free"
  exit 0
fi

# EVERYTHING THIS RUN MAY TAKE IS TAKEN, so what is left is somebody else's
# and no step of this job may remove it. The floor holds: a build that cannot
# finish must not start. What a person needs is what is holding the disk, so
# that is what this prints — measured, rather than a guess at what should be
# there.
{
  echo "::error::$((free + reused))G to build in (${free}G free after reclaiming, plus the ${reused}G in $OUT the build writes over) and a release build needs ${FLOOR_GB}G"
  echo
  echo "This run has already dropped the litter it owns: the stage directory"
  echo "and the unpacked tarball. It did not drop $CHROMIUM/$OUT: that frees"
  echo "no more than a clean build writes back. Nothing else under"
  echo "$BUILD_ROOT is this run's to remove, so this needs a person on the"
  echo "machine deciding what goes. What is holding it:"
  echo
  du -sh "$BUILD_ROOT"/* 2>&1 | sed 's/^/  /'
  echo
  echo "and inside every tree in the pool, this one's included:"
  echo
  # Its own call: `du` skips a directory an earlier argument already counted,
  # so beside the top level these would print nothing.
  du -sh "$TREES"/*/engine-release "$TREES"/*/src/out/* 2>&1 | sed 's/^/  /'
} >&2
exit 1
