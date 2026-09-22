#!/usr/bin/env bash
# Room for a release build, made rather than asked for.
#
#   .github/scripts/engine-release-room.sh /build/chromium/src out/Release /build/engine-release
#
# RUN AFTER THE TREE LOCK IS TAKEN, NEVER BEFORE. Two of the three things
# this removes are inside the shared checkout, and deleting anything in there
# while another writer is in that tree is exactly the corruption
# engine-tree-lock.sh exists to prevent. See .github/workflows/engine-release.yml.
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

# The tarball unpacked back into the checkout, which the workflow tests the
# packaged build out of. Derived rather than named, because it is the release
# output directory with a suffix and the two must not be able to drift.
STAGED="$OUT-staged"

# A non-component Chromium is ~40G of objects. Under 60 there is no point
# starting: the failure four hours in is a full dataset, and this is also
# where the machine's interactive builds live.
FLOOR_GB=60

# Whole gigabytes free on the dataset the checkout is on, as a bare number:
# `df` prints a header and a `54G`, and every comparison below wants the 54.
free_gb() { df -BG --output=avail "$CHROMIUM" | tail -1 | tr -dc '0-9'; }

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

free="$(free_gb)"
echo "that leaves ${free}G free"
if [ "$free" -ge "$FLOOR_GB" ]; then
  exit 0
fi

# THEN THE ONE THAT COSTS SOMETHING, AND ONLY THEN. `$OUT` is this workflow's
# own build directory and nothing else reads it, so it is this run's to drop —
# but dropping it turns a ~15m incremental build into a clean one, which is
# four hours on this machine. A run that takes four hours still publishes an
# engine; a run refused for want of space publishes nothing at all.
echo "still short, so the build cache goes too"
echo "  $CHROMIUM/$OUT — this workflow's objects, which costs this run a"
echo "  clean build: four hours rather than the usual few minutes"
rm -rf "$CHROMIUM/$OUT"

free="$(free_gb)"
echo "that leaves ${free}G free"
if [ "$free" -ge "$FLOOR_GB" ]; then
  exit 0
fi

# EVERYTHING THIS RUN OWNS IS ALREADY GONE, so what is left is somebody
# else's and no step of this job may take it. The floor holds: a build that
# cannot finish must not start, because the failure four hours in is a full
# dataset on the machine this repository's other work lives on.
{
  echo "::error::${free}G free after reclaiming; a release build needs ~40G and this will not fit"
  echo
  echo "This run has already dropped everything it owns under /build: the"
  echo "stage directory, the unpacked tarball, and its own build cache."
  echo "What is holding the rest is not this workflow's to remove:"
  echo
  echo "  $CHROMIUM/out/Domicile   engine.yml's component build, ~97G. Removing"
  echo "                           it costs that workflow a four-hour rebuild."
  echo "  $CHROMIUM                the checkout itself, which is not a cache."
  echo
  echo "So this needs a person on the machine deciding what goes."
} >&2
exit 1
