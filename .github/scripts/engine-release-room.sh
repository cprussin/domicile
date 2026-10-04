#!/usr/bin/env bash
# Free disk space for a release build, deleting the cheapest things first.
#
#   .github/scripts/engine-release-room.sh <chromium/src> out/Release <stage> <owner>
#
# Run only after taking this tree's lock (engine-tree-lock.sh), since it
# deletes files in the checkout. It takes each other tree's lock before
# deleting in it and skips trees it cannot lock. Tested by
# scripts/test-engine-release-room.sh.
#
# Never deletes this run's own `$OUT`, which would force a multi-hour cold
# build. The compiler cache is trimmed by age, never cleared.
set -euo pipefail

# All four are required. This script deletes what it is given, so it does not
# guess defaults.
CHROMIUM="${1:-}"
OUT="${2:-}"
STAGE="${3:-}"
OWNER="${4:-}"

if [ -z "$CHROMIUM" ] || [ -z "$OUT" ] || [ -z "$STAGE" ] || [ -z "$OWNER" ]; then
  echo "usage: $(basename "$0") <chromium/src> <out dir> <stage dir> <owner>" >&2
  exit 2
fi

# The unpacked tarball the workflow tests the packaged build from.
STAGED="$OUT-staged"

# Disk a build writes, measured on `crux`:
#
#   out/Release, cold                            1.9-2.8G
#   the compiler cache, whole                    3.3-4G
#   this job's TMPDIR                            ~1.2G
#   the tarball and its unpacked copy            under 2.8G each
#
# At most ~13.6G, so 15G.
FLOOR_GB=15

# A temp directory is stale once its ctime is older than the longest job
# timeout (engine.yml's 1200 minutes). scripts/test-engine-release-room.sh
# checks this against every workflow's `timeout-minutes`.
STALE_TMP_MINUTES=1440

# The tree pool's root (see engine-tree-pool.sh). Overridable for tests.
BUILD_ROOT="${DOMICILE_BUILD_ROOT:-/build}"
TREES="$BUILD_ROOT/trees"
# The TMPDIR both runner units share.
TMP="$BUILD_ROOT/tmp"
# An old stage directory. Nothing writes here, and its contents are already
# published.
LEGACY_STAGE="$BUILD_ROOT/engine-release"
# Overridable for tests, which cannot set a directory's ctime.
NOW="${DOMICILE_NOW:-$(date +%s)}"
LOCK_SH="$(cd "$(dirname "$0")" && pwd)/engine-tree-lock.sh"
RECLAIMER="$OWNER, reclaiming disk"

# Whole gigabytes free on the checkout's filesystem, as a bare number.
free_gb() { df -BG --output=avail "$CHROMIUM" | tail -1 | tr -dc '0-9'; }

# Report free space, and exit the script once it meets the floor.
done_if_room() {
  free="$(free_gb)"
  echo "that leaves ${free}G free"
  if [ "$free" -ge "$FLOOR_GB" ]; then
    exit 0
  fi
}

# `rm -rf` that also removes read-only files copied from the nix store. Skips
# missing paths, including unmatched globs.
remove() {
  local path
  for path in "$@"; do
    if [ -e "$path" ]; then
      chmod -R u+w "$path"
      rm -rf "$path"
    fi
  done
}

# Stale nix and job temp directories in the shared TMPDIR. Only these name
# patterns are considered.
stale_tmp() {
  local entry
  for entry in "$TMP"/nix-shell.* "$TMP"/nix-develop.* "$TMP"/dj.*; do
    if [ -e "$entry" ] &&
      [ $((NOW - $(stat -c %Z "$entry"))) -gt $((STALE_TMP_MINUTES * 60)) ]; then
      printf '%s\n' "$entry"
    fi
  done
}

# Every other tree, least recently used first, matching the order
# engine-tree-pool.sh reuses them. A never-used tree sorts first.
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

# 1. Temp directories nix left behind; see engine-job-tmp.sh.
mapfile -t stale < <(stale_tmp)
if [ "${#stale[@]}" -gt 0 ]; then
  echo "short, so temp directories older than any job go:"
  printf '  %s\n' "${stale[@]}"
  remove "${stale[@]}"
  done_if_room
fi

# 2. Published tarballs: the old stage and this run's stage, which packaging
# rewrites.
echo "still short, so tarballs of releases already published go:"
echo "  $LEGACY_STAGE/domicile-engine-*"
echo "  $STAGE"
remove "$LEGACY_STAGE"/domicile-engine-* "$STAGE"
done_if_room

# 3. This tree's unpacked tarball, which the guard step rewrites.
echo "still short, so last run's unpacked tarball goes:"
echo "  $CHROMIUM/$STAGED"
remove "$CHROMIUM/$STAGED"
done_if_room

# 4. The same in every unheld tree, under that tree's lock. Held trees are
# skipped.
for slot in $(other_trees); do
  if { [ -e "$slot/engine-release" ] || [ -e "$slot/src/$STAGED" ]; } &&
    "$LOCK_SH" take "$slot/src" "$RECLAIMER" >/dev/null 2>&1; then
    echo "still short, so ${slot##*/}'s tarballs and unpacked tarball go"
    remove "${slot:?}/engine-release" "${slot:?}/src/$STAGED"
    "$LOCK_SH" drop "$slot/src" "$RECLAIMER" >/dev/null
    done_if_room
  fi
done

# 5. Compiler cache entries unused for a week. Safe during a build.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  echo "still short, so compiler cache entries unused for a week go"
  "$DOMICILE_CC_WRAPPER" --evict-older-than 7d
  done_if_room
fi

# 6. Build output of unheld trees, under each tree's lock. Costs a rebuild
# only if a run wants that tree's pin again.
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

# 7. Compiler cache entries unused for a day. Newer ones serve running builds.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  echo "still short, so compiler cache entries unused for a day go"
  "$DOMICILE_CC_WRAPPER" --evict-older-than 1d
  done_if_room
else
  echo "DOMICILE_CC_WRAPPER is unset, so there is no compiler cache to trim"
fi

# Nothing safe is left to delete. Fail now rather than fill the disk hours
# into the build.
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
