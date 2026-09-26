#!/usr/bin/env bash
# That a build reclaims the pool's caches rather than telling a person to.
#
# The space check refused run 35552629257 in two seconds with 54G free on a
# 200G dataset, printed the remedy — "Reclaim it by removing $CHROMIUM/$OUT,
# which is a cache and nothing else" — and then did not apply it. Nobody can
# log into `crux` from CI, so that sentence stopped the release outright.
# engine.yml kept that sentence, and run 36224113579 died on it twice: 58G
# free, then 52G, on a /build every tree in the pool and the compiler cache
# share.
#
# WHAT THE TEST IS REALLY ABOUT IS WHAT MUST SURVIVE. A step that frees space
# on a shared build host has one interesting failure and it is not "did not
# free enough": it is freeing something that belongs to somebody else. A tree
# another run holds is that run's, however long ago it was used, so every case
# below that reclaims anything also asserts that tree's build is still there.
# The other half is the floor itself, which is not a thing to negotiate with:
# a build that cannot finish must still refuse to start.
#
# `df` and `ccache` are stubbed on PATH rather than injected, because they are
# the collaborators here this repository does not own and a test cannot make a
# 200G dataset 54G full to order. The `df` stub answers from the pool rather
# than from a script of numbers: how much is free is a function of which caches
# are still on disk, which is exactly the relationship under test — a reclaim
# that deletes nothing cannot be made to look like one that worked.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM="$ROOT/.github/scripts/engine-release-room.sh"
LOCK_SH="$ROOT/.github/scripts/engine-tree-lock.sh"
RELEASE_FLOW="$ROOT/.github/workflows/engine-release.yml"
ENGINE_FLOW="$ROOT/.github/workflows/engine.yml"
[ -x "$ROOM" ] || { echo "no $ROOM" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The pool as it is on `crux`: this run's tree and three others. tree-1 was
# asked for longest ago, tree-2 recently, and tree-3 is another run's.
export DOMICILE_BUILD_ROOT="$WORK/build"
TREES="$DOMICILE_BUILD_ROOT/trees"
CHROMIUM="$TREES/tree-0/src"
STAGE="$TREES/tree-0/engine-release"
ME="engine.yml run 1 attempt 1"
THEM="engine.yml run 2 attempt 1"

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

# What each cache gives back when it goes. A release build is 40G of objects
# and a four-hour rebuild, in this tree or any other; the stage and the staged
# tree are this workflow's litter; the compiler cache gives back 5G of entries
# nobody has used in a week and 5G more when it is emptied.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/df" <<'DF'
#!/usr/bin/env bash
# Free space, as the pool makes it: the scenario's starting number plus
# whatever each cache would give back, counted once it is gone.
free="$FAKE_FREE_GB"
[ -d "$FAKE_STAGE" ] || free=$((free + 5))
[ -d "$FAKE_CHROMIUM/out/Release-staged" ] || free=$((free + 3))
for tree in "$FAKE_TREES"/*/src; do
  [ -d "$tree/out/Release" ] || free=$((free + 40))
done
[ -e "$FAKE_CCACHE/old" ] || free=$((free + 5))
[ -e "$FAKE_CCACHE/new" ] || free=$((free + 5))
echo "Avail"
echo "${free}G"
DF
cat >"$WORK/bin/ccache" <<'CCACHE'
#!/usr/bin/env bash
case "$*" in
  "--evict-older-than 7d") rm -f "$FAKE_CCACHE/old" ;;
  "--clear") rm -f "$FAKE_CCACHE/old" "$FAKE_CCACHE/new" ;;
  *) echo "unexpected: ccache $*" >&2; exit 1 ;;
esac
CCACHE
chmod +x "$WORK/bin/df" "$WORK/bin/ccache"
export PATH="$WORK/bin:$PATH"
export FAKE_CHROMIUM="$CHROMIUM" FAKE_STAGE="$STAGE" FAKE_TREES="$TREES" \
  FAKE_CCACHE="$WORK/ccache"
export DOMICILE_CC_WRAPPER="$WORK/bin/ccache"

# The pool a run arrives at: every tree built, this one with the unpacked
# tarball the last run left and a tarball from a release already published,
# and a compiler cache with old entries and new ones in it.
a_pool() {
  local slot
  rm -rf "$DOMICILE_BUILD_ROOT" "$WORK/ccache"
  for slot in 0 1 2 3; do
    mkdir -p "$TREES/tree-$slot/src/out/Release"
    : >"$TREES/tree-$slot/src/out/Release/chrome"
  done
  touch -d '3 days ago' "$TREES/tree-1/.domicile-last-used"
  touch -d '1 hour ago' "$TREES/tree-2/.domicile-last-used"
  mkdir -p "$CHROMIUM/out/Release-staged" "$STAGE" "$WORK/ccache"
  : >"$CHROMIUM/out/Release-staged/chrome"
  : >"$STAGE/domicile-engine-0000000-linux-x64.tar.zst"
  : >"$WORK/ccache/old"
  : >"$WORK/ccache/new"
  "$LOCK_SH" take "$CHROMIUM" "$ME" >/dev/null
  # Held by another run, and never handed out by the pool, so the oldest of
  # them all: least recently used is the order the free trees go in, never a
  # reason to take a held one.
  "$LOCK_SH" take "$TREES/tree-3/src" "$THEM" >/dev/null
}
held_by_them() { # slot
  "$LOCK_SH" take "$TREES/tree-$1/src" "$THEM" >/dev/null
}

# Status on the first line, what it said after — the shape the tree lock's
# test uses, because a refusal's words are half of what is being asserted.
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

# --- room already, so nothing is touched ------------------------------------

# THE CASE THAT COSTS FOUR HOURS TO GET WRONG. A step that reclaims on every
# run throws away an incremental build that fits perfectly well, every time.
a_pool
SAID="$(room 61)"
expect "a tree with room in it is left alone" ok "$(status "$SAID")"
expect "the build directory survives" yes "$(built 0)"
expect "and so does the staged tree" yes "$(there "$CHROMIUM/out/Release-staged")"
expect "and so do the tarballs" yes \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"
expect "and so does every other tree's build" yesyes "$(built 1)$(built 2)"
expect "and the compiler cache" yes "$(there "$WORK/ccache/old")"

# --- short, and the litter is enough ----------------------------------------

# The cheap reclaim comes first and is measured before the expensive one is
# reached for: published tarballs and an unpacked copy of one are worth
# nothing, and `out/Release` is worth four hours.
a_pool
SAID="$(room 55)"
expect "a tree without room is not refused for what it can reclaim" \
  ok "$(status "$SAID")"
expect "the tarballs of published releases go" no \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"
expect "and the unpacked copy the guard tests goes" no \
  "$(there "$CHROMIUM/out/Release-staged")"
expect "but the build directory is kept, because it was not needed" yes \
  "$(built 0)"
expect "and so is every other tree's" yesyes "$(built 1)$(built 2)"
contains "it says what it dropped" "$STAGE" "$SAID"
contains "and what it has now" "free" "$SAID"

# --- short, and a free tree's build is enough -------------------------------

# A free tree's build is the next cheapest thing: it costs a rebuild only if a
# run wants that tree's pin again, where this run's own costs one now.
a_pool
SAID="$(room 45)"
expect "a pool that needs one free tree's build gets there" ok "$(status "$SAID")"
expect "the least recently used free tree's build goes" no "$(built 1)"
expect "but only one, because one was enough" yes "$(built 2)"
expect "a tree another run holds is never touched, however old" yes "$(built 3)"
expect "and it is still theirs" "$THEM" \
  "$(cat "$("$LOCK_SH" path "$TREES/tree-3/src")/owner")"
expect "the tree it reclaimed is not left locked" no \
  "$(there "$("$LOCK_SH" path "$TREES/tree-1/src")")"
expect "this run's own build is kept" yes "$(built 0)"
expect "and so is the compiler cache" yes "$(there "$WORK/ccache/new")"
contains "it says whose build it dropped" "tree-1" "$SAID"

# --- every free tree reclaimed, so the compiler cache goes ------------------

a_pool
held_by_them 2
SAID="$(room 5)"
expect "a pool that needs the compiler cache gets there" ok "$(status "$SAID")"
expect "the free tree's build went first" no "$(built 1)"
expect "the held one did not" yes "$(built 2)"
expect "the compiler cache is emptied" no "$(there "$WORK/ccache/new")"
expect "but this run's own build is kept, because it was not needed" yes \
  "$(built 0)"

# A machine that names no compiler cache has none to trim, which is not a
# reason to stop short of the reclaim that is left.
a_pool
held_by_them 1
held_by_them 2
SAID="$(DOMICILE_CC_WRAPPER='' room 18)"
expect "no compiler cache is no reason to refuse" ok "$(status "$SAID")"
expect "and the cache it did not name is not touched" yes \
  "$(there "$WORK/ccache/old")"

# --- short enough that this run's own build directory has to go ------------

a_pool
held_by_them 1
held_by_them 2
SAID="$(room 10)"
expect "a tree that needs the build directory gets there" ok "$(status "$SAID")"
expect "the build directory goes" no "$(built 0)"
# Not the path on its own: `out/Release-staged` has `out/Release` inside it,
# so a message about only the cheap reclaim matches that and says nothing.
contains "it says so, and what rebuilding it costs" "four hours" "$SAID"
expect "the trees other runs hold keep theirs" yesyesyes \
  "$(built 1)$(built 2)$(built 3)"

# --- short even with everything gone ----------------------------------------

# THE FLOOR IS NOT NEGOTIABLE. Reclaiming is what this step gained; the thing
# it must not lose is refusing a build that cannot finish. A release that
# starts anyway fills the dataset this machine's other work lives on, four
# hours in.
a_pool
held_by_them 1
held_by_them 2
SAID="$(room 0)"
expect "a tree that is still short after reclaiming is refused" \
  refused "$(status "$SAID")"
contains "the refusal says how much is free after the reclaim" "58G" "$SAID"
contains "and that it already reclaimed what it could" "reclaim" "$SAID"
contains "and names the holders of what it would not take" "$THEM" "$SAID"
expect "which it did not take" yesyesyes "$(built 1)$(built 2)$(built 3)"
expect "and the checkout is not a cache" yes "$(there "$CHROMIUM")"

# --- the workflows this exists for ------------------------------------------

# A SCRIPT NOTHING CALLS IS THE OLD FAILURE WITH A TEST OVER IT. Every case
# above stays green if a workflow goes on measuring inline, which is what
# engine.yml did when run 36224113579 failed.
#
# AND WHERE IT IS CALLED FROM IS THE WHOLE SAFETY ARGUMENT. `out/Release` and
# `out/Release-staged` are inside a shared checkout, and deleting anything in
# there while another writer is in that tree is precisely what the tree lock
# exists to prevent. And the tree this run reclaims in is whichever one the
# pool handed it -- `$CHROMIUM` is written by that step, so a reclaim before it
# would resolve to nothing at all.
#
# Both halves are one step now: `engine-tree-pool.sh pick` chooses a tree and
# locks it in the same call, because choosing and then locking is a tree
# another run can take in between.
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
