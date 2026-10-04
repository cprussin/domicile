#!/usr/bin/env bash
# Asserts `engine-release-room.sh` frees space on the build pool itself,
# cheapest caches first.
#
# Nobody can log into `crux` from CI, so a space check that only prints a
# remedy stops the release. Reclaim order, cheapest first, is listed in
# `.github/scripts/engine-release-room.sh`.
#
# Never reclaimed: this run's build, trees another run holds, temp directories
# a live job may own, and today's compiler cache. A build that still cannot fit
# must refuse to start.
#
# `df` and `ccache` are stubbed on PATH. The `df` stub computes free space from
# which caches remain, so a reclaim that deletes nothing cannot pass.
#
# `DOMICILE_NOW` injects the clock, since a test cannot set a directory's
# ctime.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM="$ROOT/.github/scripts/engine-release-room.sh"
LOCK_SH="$ROOT/.github/scripts/engine-tree-lock.sh"
RELEASE_FLOW="$ROOT/.github/workflows/engine-release.yml"
ENGINE_FLOW="$ROOT/.github/workflows/engine.yml"
[ -x "$ROOM" ] || { echo "no $ROOM" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'chmod -R u+w "$WORK"; rm -rf "$WORK"' EXIT

# The pool on `crux`: this run's tree and three others. tree-1 was used
# longest ago, tree-2 recently, and tree-3 is held by another run.
export DOMICILE_BUILD_ROOT="$WORK/build"
TREES="$DOMICILE_BUILD_ROOT/trees"
TMP="$DOMICILE_BUILD_ROOT/tmp"
LEGACY="$DOMICILE_BUILD_ROOT/engine-release"
CHROMIUM="$TREES/tree-0/src"
STAGE="$TREES/tree-0/engine-release"
ME="engine.yml run 1 attempt 1"
THEM="engine.yml run 2 attempt 1"
TWO_DAYS_ON=$(($(date +%s) + 2 * 86400))

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
there() { [ -e "$1" ] && echo yes || echo no; }

# Space each item frees, in proportions measured on `crux`: leaked temp
# directories are the largest, then published tarballs, builds, and the
# compiler cache (split into week-old, day-old and today's entries).
mkdir -p "$WORK/bin"
cat >"$WORK/bin/df" <<'DF'
#!/usr/bin/env bash
free="$FAKE_FREE_GB"
[ -e "$FAKE_TMP/nix-shell.leaked" ] || free=$((free + 6))
[ -e "$FAKE_TMP/dj.leaked" ] || free=$((free + 2))
[ -e "$FAKE_LEGACY/domicile-engine-0000000-linux-x64.tar.zst" ] || free=$((free + 4))
for tree in "$FAKE_TREES"/*; do
  [ -d "$tree/engine-release" ] || free=$((free + 1))
  [ -d "$tree/src/out/Release-staged" ] || free=$((free + 1))
  [ -d "$tree/src/out/Release" ] || free=$((free + 3))
done
[ -e "$FAKE_CCACHE/week" ] || free=$((free + 1))
[ -e "$FAKE_CCACHE/day" ] || free=$((free + 1))
[ -e "$FAKE_CCACHE/today" ] || free=$((free + 2))
echo "Avail"
echo "${free}G"
DF
# Model `--clear` instead of rejecting it, so a script that uses it fails the
# survival assertions.
cat >"$WORK/bin/ccache" <<'CCACHE'
#!/usr/bin/env bash
case "$*" in
  "--evict-older-than 7d") rm -f "$FAKE_CCACHE/week" ;;
  "--evict-older-than 1d") rm -f "$FAKE_CCACHE/week" "$FAKE_CCACHE/day" ;;
  "--clear"|"-C") rm -f "$FAKE_CCACHE"/* ;;
  *) echo "unexpected: ccache $*" >&2; exit 1 ;;
esac
CCACHE
chmod +x "$WORK/bin/df" "$WORK/bin/ccache"
export PATH="$WORK/bin:$PATH"
export FAKE_TMP="$TMP" FAKE_LEGACY="$LEGACY" FAKE_TREES="$TREES" \
  FAKE_CCACHE="$WORK/ccache"
export DOMICILE_CC_WRAPPER="$WORK/bin/ccache"

# A pool as a run finds it: every tree built, each with a stage and an
# unpacked tarball; published tarballs; a leaked nix-shell directory
# (read-only inside, like a store copy), a job's undeleted temp directory, and
# an unrelated entry in /build/tmp; and a compiler cache.
a_pool() {
  local slot
  if [ -d "$DOMICILE_BUILD_ROOT" ]; then
    chmod -R u+w "$DOMICILE_BUILD_ROOT"
  fi
  rm -rf "$DOMICILE_BUILD_ROOT" "$WORK/ccache"
  for slot in 0 1 2 3; do
    mkdir -p "$TREES/tree-$slot/src/out/Release" \
      "$TREES/tree-$slot/src/out/Release-staged" \
      "$TREES/tree-$slot/engine-release"
    : >"$TREES/tree-$slot/src/out/Release/chrome"
    : >"$TREES/tree-$slot/engine-release/domicile-engine-000000$slot-linux-x64.tar.zst"
  done
  touch -d '3 days ago' "$TREES/tree-1/.domicile-last-used"
  touch -d '1 hour ago' "$TREES/tree-2/.domicile-last-used"
  mkdir -p "$TMP/nix-shell.leaked/store-copy" "$TMP/dj.leaked" \
    "$TMP/.dotnet" "$LEGACY" "$WORK/ccache"
  : >"$TMP/nix-shell.leaked/store-copy/rc"
  chmod a-w "$TMP/nix-shell.leaked/store-copy"
  : >"$LEGACY/domicile-engine-0000000-linux-x64.tar.zst"
  : >"$WORK/ccache/week"
  : >"$WORK/ccache/day"
  : >"$WORK/ccache/today"
  "$LOCK_SH" take "$CHROMIUM" "$ME" >/dev/null
  # Held by another run and never handed out, so it is the oldest. Least
  # recently used orders free trees only; it never makes a held tree eligible.
  "$LOCK_SH" take "$TREES/tree-3/src" "$THEM" >/dev/null
}
held_by_them() { # slot
  "$LOCK_SH" take "$TREES/tree-$1/src" "$THEM" >/dev/null
}

# Prints status on the first line and the script's output after it.
room() { # free gigabytes to start from
  local out
  if out="$(FAKE_FREE_GB="$1" "$ROOM" "$CHROMIUM" out/Release "$STAGE" "$ME" 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }
built() { there "$TREES/tree-$1/src/out/Release"; }
staged() { there "$TREES/tree-$1/src/out/Release-staged"; }
stage() { there "$TREES/tree-$1/engine-release"; }
leaked() { there "$TMP/nix-shell.leaked"; }
published() { there "$LEGACY/domicile-engine-0000000-linux-x64.tar.zst"; }

# --- room already, so nothing is touched ------------------------------------

# A run with enough room must not reclaim, or it discards a usable incremental
# build.
a_pool
SAID="$(DOMICILE_NOW=$TWO_DAYS_ON room 15)"
expect "a tree with room in it is left alone" ok "$(status "$SAID")"
expect "even the leaked temp directories, stale as they are" yes "$(leaked)"
expect "and the published tarballs" yes "$(published)"
expect "and its build and stage" yesyesyes "$(built 0)$(staged 0)$(stage 0)"
contains "the floor is what a build measured, not ~40G" "floor of 15G" "$SAID"

# --- short, and what nix leaked is enough -----------------------------------

# Leaked temp directories go first; they free the most. One older than a day
# belongs to no running job.
a_pool
SAID="$(DOMICILE_NOW=$TWO_DAYS_ON room 7)"
expect "a day-old leak is enough, so the run goes ahead" ok "$(status "$SAID")"
expect "a leaked nix-shell directory goes, read-only insides and all" no "$(leaked)"
expect "and so does a job's temp directory its job never dropped" no \
  "$(there "$TMP/dj.leaked")"
expect "but what is in /build/tmp that neither made stays" yes \
  "$(there "$TMP/.dotnet")"
expect "and nothing dearer was reached for" yesyesyes \
  "$(published)$(stage 0)$(staged 0)"
contains "it says what it dropped" "nix-shell.leaked" "$SAID"

# --- short, and the published tarballs are enough ---------------------------

# A temp directory made today may belong to a live job on either runner, so it
# is never deleted.
a_pool
SAID="$(room 10)"
expect "a run short by the tarballs gets there" ok "$(status "$SAID")"
expect "a temp directory made today is left, because a live job may own it" \
  yesyes "$(leaked)$(there "$TMP/dj.leaked")"
expect "the tarballs where the stage used to be go" no "$(published)"
expect "and this run's own stage" no "$(stage 0)"
expect "but its unpacked tarball is kept, because it was not needed" yes \
  "$(staged 0)"

# Items an earlier run already removed must not stop the reclaim.
a_pool
rm -rf "$LEGACY"/* "$STAGE" "$CHROMIUM/out/Release-staged"
SAID="$(room 4)"
expect "a pool whose litter is already gone reaches the next thing" ok \
  "$(status "$SAID")"
expect "which is the free trees' litter" nono "$(stage 1)$(staged 1)"

# --- short, and every free tree's litter is enough --------------------------

a_pool
SAID="$(room 5)"
expect "a run short by every tree's litter gets there" ok "$(status "$SAID")"
expect "this run's unpacked tarball goes" no "$(staged 0)"
expect "the least recently used free tree's stage and unpacked tarball go" \
  nono "$(stage 1)$(staged 1)"
expect "and the other free tree's" nono "$(stage 2)$(staged 2)"
expect "a tree another run holds keeps its litter, however old" yesyes \
  "$(stage 3)$(staged 3)"
expect "and every build survives it" yesyesyesyes \
  "$(built 0)$(built 1)$(built 2)$(built 3)"
expect "the tree it reclaimed in is not left locked" no \
  "$(there "$("$LOCK_SH" path "$TREES/tree-1/src")")"
expect "and the compiler cache is not touched" yes "$(there "$WORK/ccache/week")"

# --- short, and a free tree's build is enough -------------------------------

# Week-old cache entries go before any build, and one free tree's build goes
# before newer entries: a build only costs a rebuild if a run needs that tree's
# pin again.
a_pool
SAID="$(room 2)"
expect "a pool that needs one free tree's build gets there" ok "$(status "$SAID")"
expect "compiler cache entries a week old went first" no \
  "$(there "$WORK/ccache/week")"
expect "the least recently used free tree's build goes" no "$(built 1)"
expect "but only one, because one was enough" yes "$(built 2)"
expect "a tree another run holds is never touched, however old" yes "$(built 3)"
expect "and it is still theirs" "$THEM" \
  "$(cat "$("$LOCK_SH" path "$TREES/tree-3/src")/owner")"
expect "this run's own build is kept" yes "$(built 0)"
expect "and so are the day-old cache entries" yes "$(there "$WORK/ccache/day")"
contains "it says whose build it dropped" "tree-1" "$SAID"

# --- every free tree reclaimed, so the day-old cache entries go -------------

a_pool
held_by_them 1
held_by_them 2
SAID="$(room 7)"
expect "a pool that needs the day-old cache entries gets there" ok \
  "$(status "$SAID")"
expect "they go" no "$(there "$WORK/ccache/day")"
expect "and today's stay: the cache is trimmed, never emptied" yes \
  "$(there "$WORK/ccache/today")"

# Without a compiler cache, the reclaim continues with what is left.
a_pool
SAID="$(DOMICILE_CC_WRAPPER='' room 2)"
expect "no compiler cache is no reason to refuse" ok "$(status "$SAID")"
expect "and the cache it did not name is not touched" yes \
  "$(there "$WORK/ccache/week")"

# --- short even with everything gone ----------------------------------------

# The floor holds, and this run's build is kept: deleting it forces a cold
# build of over four hours. The run refuses and says why, and the next run
# stays warm.
a_pool
held_by_them 1
held_by_them 2
SAID="$(room 0)"
expect "a tree that is still short after reclaiming is refused" \
  refused "$(status "$SAID")"
expect "its own build is still there for the next run" yes "$(built 0)"
expect "and so is today's compiler cache" yes "$(there "$WORK/ccache/today")"
contains "the refusal says how much is free after the reclaim" "8G free" "$SAID"
contains "and against what floor" "floor of 15G" "$SAID"
contains "and names the holders of what it would not take" "$THEM" "$SAID"
expect "which it did not take" yesyesyes "$(built 1)$(built 2)$(built 3)"
expect "and the checkout is not a cache" yes "$(there "$CHROMIUM")"

# --- stale is provable only against the longest job -------------------------

# "Older than a day, so no live job's" holds only while no job runs that long.
# Checks the script's bound against the workflows' timeouts.
STALE="$(sed -n 's/^STALE_TMP_MINUTES=\([0-9]*\).*/\1/p' "$ROOM")"
LONGEST="$(grep -h '^ *timeout-minutes:' "$ROOT"/.github/workflows/*.yml |
  tr -dc '0-9\n' | sort -n | tail -1)"
if [ -n "$STALE" ] && [ "$LONGEST" -lt "$STALE" ]; then
  printf '  ok    stale means older than the longest job (%sm < %sm)\n' \
    "$LONGEST" "$STALE"
else
  printf '  FAIL  stale means older than the longest job\n    longest: %s stale: %s\n' \
    "$LONGEST" "${STALE:-none}"
  FAILED=$((FAILED + 1))
fi

# --- the workflows this exists for ------------------------------------------

# Both workflows must call this script, or every case above passes while the
# workflow measures inline.
#
# It must run after `engine-tree-pool.sh pick`, which picks and locks a tree in
# one call and sets `$CHROMIUM`. Deleting in a shared checkout is safe only
# under the tree lock, and before the pick `$CHROMIUM` is unset.
for flow in "$RELEASE_FLOW" "$ENGINE_FLOW"; do
  name="$(basename "$flow")"
  POOL="$(grep -n 'engine-tree-pool.sh pick' "$flow" | head -1 | cut -d: -f1)"
  RECLAIM="$(grep -n 'run: .github/scripts/engine-release-room.sh' "$flow" | head -1 | cut -d: -f1)"
  if [ -n "$RECLAIM" ]; then
    printf '  ok    %s reclaims through this script\n' "$name"
  else
    printf '  FAIL  %s reclaims through this script\n' "$name"
    FAILED=$((FAILED + 1))
  fi
  if [ -n "$POOL" ] && [ -n "$RECLAIM" ] && [ "$POOL" -lt "$RECLAIM" ]; then
    printf '  ok    and only once it holds a tree the pool locked for it\n'
  else
    printf '  FAIL  and only once it holds a tree the pool locked for it\n    pick: %s reclaim: %s\n' \
      "${POOL:-none}" "${RECLAIM:-none}"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
