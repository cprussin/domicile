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
# `out/Domicile` is what `build.sh` builds by hand and is four hours to
# rebuild, so every case below that reclaims anything also asserts that
# directory is still there. The other half is the floor itself, which is not a
# thing to negotiate with: a build that cannot finish must still refuse to
# start.
#
# A WARM BUILD DIRECTORY IS ROOM, and that is the third. PR #578's run
# 36229767471 was refused with 52G free beside a tree-0 `out/Release` built
# from the series before, at the same pin: a build that would have rewritten
# some objects in place was judged as though it needed 40G of new ones.
#
# `df` is stubbed on PATH rather than injected, because it is the one
# collaborator here this repository does not own and a test cannot make a
# 200G dataset 54G full to order. The stub answers from the tree rather than
# from a script of numbers: how much is free is a function of which caches are
# still on disk, which is exactly the relationship under test — a reclaim that
# deletes nothing cannot be made to look like one that worked. `du` is stubbed
# beside it for the same reason: a test cannot make `out/Release` 40G either.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM="$ROOT/.github/scripts/engine-release-room.sh"
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
# one — as many gigabytes as the scenario says, and a four-hour rebuild — and
# the other two are this workflow's litter: the tarball of every release ever
# packaged, and the unpacked copy the guard step tests.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/df" <<'DF'
#!/usr/bin/env bash
# Free space, as the tree makes it: the scenario's starting number plus
# whatever each cache would give back, counted once it is gone.
free="$FAKE_FREE_GB"
[ -d "$FAKE_STAGE" ] || free=$((free + 5))
[ -d "$FAKE_CHROMIUM/out/Release-staged" ] || free=$((free + 3))
[ -d "$FAKE_CHROMIUM/out/Release" ] || free=$((free + FAKE_RELEASE_GB))
echo "Avail"
echo "${free}G"
DF
# Sizes in KiB, a line per path, whatever the flags: the build directory is as
# big as the scenario says and everything else is one block.
cat >"$WORK/bin/du" <<'DU'
#!/usr/bin/env bash
for path in "$@"; do
  case "$path" in
    (-*) ;;
    ("$FAKE_CHROMIUM/out/Release") printf '%s\t%s\n' "$((FAKE_RELEASE_GB * 1048576))" "$path" ;;
    (*) printf '4\t%s\n' "$path" ;;
  esac
done
DU
chmod +x "$WORK/bin/df" "$WORK/bin/du"
export PATH="$WORK/bin:$PATH"
export FAKE_CHROMIUM="$CHROMIUM" FAKE_STAGE="$STAGE"
export DOMICILE_BUILD_ROOT="$WORK"

# The tree a run arrives at: its own build directory — as many gigabytes as
# asked for, and 0 is a cold tree with none — the unpacked tarball the last run
# left behind, a tarball from a release already published, and a person's
# component build beside them.
a_tree() { # gigabytes in out/Release
  rm -rf "$WORK/chromium" "$STAGE"
  export FAKE_RELEASE_GB="$1"
  mkdir -p "$CHROMIUM/out/Release-staged" "$CHROMIUM/out/Domicile" "$STAGE"
  if [ "$1" -gt 0 ]; then
    mkdir -p "$CHROMIUM/out/Release"
    : >"$CHROMIUM/out/Release/chrome"
  fi
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
a_tree 40
SAID="$(room 61)"
expect "a tree with room in it is left alone" ok "$(status "$SAID")"
expect "the build directory survives" yes "$(there "$CHROMIUM/out/Release")"
expect "and so does the staged tree" yes "$(there "$CHROMIUM/out/Release-staged")"
expect "and so do the tarballs" yes \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"

# --- short on free space, but the build directory is warm -------------------

# RUN 36229767471. The build writes over the objects already there, so the
# space they hold is space it reuses. Counting only what `df` calls free
# refused it; dropping them to make the number would have made the build cold
# — four hours — to write back exactly what it deleted.
a_tree 40
SAID="$(room 45)"
expect "a warm build directory counts toward the room it needs" \
  ok "$(status "$SAID")"
expect "and it is kept" yes "$(there "$CHROMIUM/out/Release")"
expect "and so is the litter, because none of it was needed" yes \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"
contains "it says what it counted" "the 40G" "$SAID"

# --- short, cold, and the litter is enough ----------------------------------

# The cheap reclaim comes first and is measured before the expensive one is
# reached for: published tarballs and an unpacked copy of one are worth
# nothing, and `out/Release` is worth four hours.
a_tree 0
SAID="$(room 55)"
expect "a tree without room is not refused for what it can reclaim" \
  ok "$(status "$SAID")"
expect "the tarballs of published releases go" no \
  "$(there "$STAGE/domicile-engine-0000000-linux-x64.tar.zst")"
expect "and the unpacked copy the guard tests goes" no \
  "$(there "$CHROMIUM/out/Release-staged")"
contains "it says what it dropped" "$STAGE" "$SAID"
contains "and what it has now" "free" "$SAID"

# --- a build directory bigger than the build that replaces it ---------------

# Objects from every series this tree has held. A clean build is ~40G, so what
# is over that is only given back by dropping the directory — the one case
# where dropping it makes room rather than moving it.
a_tree 70
SAID="$(room 5)"
expect "a bloated build directory is dropped to get there" ok "$(status "$SAID")"
expect "the build directory goes" no "$(there "$CHROMIUM/out/Release")"
# Not the path on its own: `out/Release-staged` has `out/Release` inside it,
# so a message about only the cheap reclaim matches that and says nothing.
contains "it says so, and what rebuilding it costs" "four hours" "$SAID"
expect "the component build beside it is not this run's to take" yes \
  "$(there "$CHROMIUM/out/Domicile")"

# --- short even with everything counted -------------------------------------

# THE FLOOR IS NOT NEGOTIABLE. Reclaiming is what this step gained; the thing
# it must not lose is refusing a build that cannot finish. A release that
# starts anyway fills the dataset this machine's other work lives on, four
# hours in.
a_tree 40
SAID="$(room 5)"
expect "a tree that is still short after reclaiming is refused" \
  refused "$(status "$SAID")"
contains "the refusal says what is free after the reclaim" "13G" "$SAID"
contains "and what that is with the build directory it reuses" "plus the 40G" "$SAID"
contains "and that it already reclaimed what it owns" "reclaim" "$SAID"
# Dropping it frees 40G for a cold build to take straight back: the same
# verdict, with four hours of cache gone for it.
expect "and keeps the build directory, which dropping could not help" yes \
  "$(there "$CHROMIUM/out/Release")"
contains "it shows a person what is holding the disk" "$WORK/bin" "$SAID"
contains "down to each output directory" "$CHROMIUM/out/Domicile" "$SAID"
expect "which it did not take" yes "$(there "$CHROMIUM/out/Domicile")"
expect "and the checkout is not a cache" yes "$(there "$CHROMIUM")"

# --- the workflows this exists for ------------------------------------------

# A SCRIPT NOTHING CALLS IS THE OLD FAILURE WITH A TEST OVER IT. Every case
# above stays green if a workflow goes on measuring inline — which engine.yml
# did: its own copy of the check refused run 36229767471 at 52G with the
# sentence this script was written to stop printing.
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
for workflow in engine-release.yml engine.yml; do
  WORKFLOW="$ROOT/.github/workflows/$workflow"
  if grep -q 'engine-release-room.sh "' "$WORKFLOW"; then
    printf '  ok    %s reclaims through this script\n' "$workflow"
  else
    printf '  FAIL  %s reclaims through this script\n' "$workflow"
    FAILED=$((FAILED + 1))
  fi
  if grep -q 'free_gb=' "$WORKFLOW"; then
    printf '  FAIL  %s keeps no free-space check of its own\n' "$workflow"
    FAILED=$((FAILED + 1))
  else
    printf '  ok    %s keeps no free-space check of its own\n' "$workflow"
  fi
  POOL="$(grep -n 'engine-tree-pool.sh pick' "$WORKFLOW" | head -1 | cut -d: -f1)"
  RECLAIM="$(grep -n 'engine-release-room.sh "' "$WORKFLOW" | head -1 | cut -d: -f1)"
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
