#!/usr/bin/env bash
# That a release reclaims its own caches rather than telling a person to.
#
# The space check refused run 35552629257 in two seconds with 54G free on a
# 200G dataset, printed the remedy — "Reclaim it by removing $CHROMIUM/$OUT,
# which is a cache and nothing else" — and then did not apply it. Nobody can
# log into `crux` from CI, so that sentence stopped the release outright.
#
# WHAT THE TEST IS REALLY ABOUT IS WHAT MUST SURVIVE. A step that frees space
# on a shared build host has one interesting failure and it is not "did not
# free enough": it is freeing something that belongs to somebody else.
# `out/Domicile` is engine.yml's and is four hours to rebuild, so every case
# below that reclaims anything also asserts that directory is still there.
# The other half is the floor itself, which is not a thing to negotiate with:
# a build that cannot finish must still refuse to start.
#
# `df` is stubbed on PATH rather than injected, because it is the one
# collaborator here this repository does not own and a test cannot make a
# 200G dataset 54G full to order. The stub answers from the tree rather than
# from a script of numbers: how much is free is a function of which caches are
# still on disk, which is exactly the relationship under test — a reclaim that
# deletes nothing cannot be made to look like one that worked.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM="$ROOT/.github/scripts/engine-release-room.sh"
WORKFLOW="$ROOT/.github/workflows/engine-release.yml"
[ -x "$ROOM" ] || { echo "no $ROOM" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CHROMIUM="$WORK/chromium/src"
STAGE="$WORK/engine-release"

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

# What each cache gives back when it goes. The release build is the expensive
# one — 40G of objects and a four-hour rebuild — and the other two are this
# workflow's litter: the tarball of every release ever packaged, and the
# unpacked copy the guard step tests.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/df" <<'DF'
#!/usr/bin/env bash
# Free space, as the tree makes it: the scenario's starting number plus
# whatever each cache would give back, counted once it is gone.
free="$FAKE_FREE_GB"
[ -d "$FAKE_STAGE" ] || free=$((free + 5))
[ -d "$FAKE_CHROMIUM/out/Release-staged" ] || free=$((free + 3))
[ -d "$FAKE_CHROMIUM/out/Release" ] || free=$((free + 40))
echo "Avail"
echo "${free}G"
DF
chmod +x "$WORK/bin/df"
export PATH="$WORK/bin:$PATH"
export FAKE_CHROMIUM="$CHROMIUM" FAKE_STAGE="$STAGE"

# The tree a run arrives at: its own build directory, the unpacked tarball the
# last run left behind, a tarball from a release already published, and
# engine.yml's build directory beside them.
a_tree() {
  rm -rf "$WORK/chromium" "$STAGE"
  mkdir -p "$CHROMIUM/out/Release" "$CHROMIUM/out/Release-staged" \
           "$CHROMIUM/out/Domicile" "$STAGE"
  : >"$CHROMIUM/out/Release/chrome"
  : >"$CHROMIUM/out/Release-staged/chrome"
  : >"$CHROMIUM/out/Domicile/chrome"
  : >"$STAGE/domicile-engine-0000000-linux-x64.tar.zst"
}

# Status on the first line, what it said after — the shape the tree lock's
# test uses, because a refusal's words are half of what is being asserted.
room() { # free gigabytes to start from
  local out
  if out="$(FAKE_FREE_GB="$1" "$ROOM" "$CHROMIUM" out/Release "$STAGE" 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }

# --- room already, so nothing is touched ------------------------------------

# THE CASE THAT COSTS FOUR HOURS TO GET WRONG. A step that reclaims on every
# run throws away an incremental build that fits perfectly well, every time.
a_tree
SAID="$(room 61)"
expect "a tree with room in it is left alone" ok "$(status "$SAID")"
expect "the build directory survives" yes "$(there "$CHROMIUM/out/Release")"
expect "and so does the staged tree" yes "$(there "$CHROMIUM/out/Release-staged")"
expect "and so do the tarballs" yes \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"

# --- short, and the litter is enough ----------------------------------------

# The cheap reclaim comes first and is measured before the expensive one is
# reached for: published tarballs and an unpacked copy of one are worth
# nothing, and `out/Release` is worth four hours.
a_tree
SAID="$(room 55)"
expect "a tree without room is not refused for what it can reclaim" \
  ok "$(status "$SAID")"
expect "the tarballs of published releases go" no \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"
expect "and the unpacked copy the guard tests goes" no \
  "$(there "$CHROMIUM/out/Release-staged")"
expect "but the build directory is kept, because it was not needed" yes \
  "$(there "$CHROMIUM/out/Release")"
contains "it says what it dropped" "$STAGE" "$SAID"
contains "and what it has now" "free" "$SAID"

# --- short enough that the build directory has to go ------------------------

a_tree
SAID="$(room 30)"
expect "a tree that needs the build directory gets there" ok "$(status "$SAID")"
expect "the build directory goes" no "$(there "$CHROMIUM/out/Release")"
# Not the path on its own: `out/Release-staged` has `out/Release` inside it,
# so a message about only the cheap reclaim matches that and says nothing.
contains "it says so, and what rebuilding it costs" "four hours" "$SAID"
expect "engine.yml's build directory is not this run's to take" yes \
  "$(there "$CHROMIUM/out/Domicile")"

# --- short even with everything gone ----------------------------------------

# THE FLOOR IS NOT NEGOTIABLE. Reclaiming is what this step gained; the thing
# it must not lose is refusing a build that cannot finish. A release that
# starts anyway fills the dataset this machine's other work lives on, four
# hours in.
a_tree
SAID="$(room 5)"
expect "a tree that is still short after reclaiming is refused" \
  refused "$(status "$SAID")"
contains "the refusal says how much is free after the reclaim" "53G" "$SAID"
contains "and that it already reclaimed what it owns" "reclaim" "$SAID"
contains "and names what it will not take" "out/Domicile" "$SAID"
expect "which it did not take" yes "$(there "$CHROMIUM/out/Domicile")"
expect "and the checkout is not a cache" yes "$(there "$CHROMIUM")"

# --- the workflow this exists for -------------------------------------------

# A SCRIPT NOTHING CALLS IS THE OLD FAILURE WITH A TEST OVER IT. Every case
# above stays green if engine-release.yml goes on measuring inline.
if grep -q 'engine-release-room.sh' "$WORKFLOW"; then
  printf '  ok    engine-release.yml reclaims through this script\n'
else
  printf '  FAIL  engine-release.yml reclaims through this script\n'
  FAILED=$((FAILED + 1))
fi

# AND WHERE IT IS CALLED FROM IS THE WHOLE SAFETY ARGUMENT. `out/Release` and
# `out/Release-staged` are inside the shared checkout, and deleting anything
# in there while another writer is in the tree is precisely what the tree lock
# exists to prevent. So the reclaim runs after the lock is taken, never
# before.
TAKE="$(grep -n 'engine-tree-lock.sh take' "$WORKFLOW" | head -1 | cut -d: -f1)"
RECLAIM="$(grep -n 'engine-release-room.sh' "$WORKFLOW" | head -1 | cut -d: -f1)"
if [ -n "$TAKE" ] && [ -n "$RECLAIM" ] && [ "$TAKE" -lt "$RECLAIM" ]; then
  printf '  ok    and only once it holds the tree lock\n'
else
  printf '  FAIL  and only once it holds the tree lock\n    take: %s reclaim: %s\n' \
    "${TAKE:-none}" "${RECLAIM:-none}"
  FAILED=$((FAILED + 1))
fi

# AND AFTER THE TREE IS CHOSEN, which is the half of the order that #485 added
# and that no amount of reading this script can reveal. `$CHROMIUM` is a path
# through a symlink `engine-tree-pool.sh` swaps between N trees, so "which
# directory is /build/chromium/src" is decided by that step and not by the
# variable. Reclaim before it and the `rm -rf` lands in whichever tree the
# LAST run left the path pointing at -- by construction not the one this run
# builds in, so it would cost some other pin its objects and free nothing that
# this run's floor is measuring. Nothing in the reclaim script can notice: it
# is handed a path and the path resolves.
POOL="$(grep -n 'engine-tree-pool.sh use' "$WORKFLOW" | head -1 | cut -d: -f1)"
if [ -n "$POOL" ] && [ -n "$RECLAIM" ] && [ "$POOL" -lt "$RECLAIM" ]; then
  printf '  ok    and only once the pool has said which tree that is\n'
else
  printf '  FAIL  and only once the pool has said which tree that is\n    pool: %s reclaim: %s\n' \
    "${POOL:-none}" "${RECLAIM:-none}"
  FAILED=$((FAILED + 1))
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
