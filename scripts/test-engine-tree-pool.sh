#!/usr/bin/env bash
# Which tree a run builds in, and the one answer that must never be wrong.
#
# The pool exists because the Chromium checkout is keyed by `CHROMIUM_PIN` and
# there is one of it. Two branches carrying different pins take turns in that
# one tree, and each turn is a reset, a `gclient sync`, an apply and a compile
# of most of Chromium — four hours, every time, in both directions. Two pull
# requests open at once is four of those. The pool is N trees behind one path,
# so a pin that has been built before is a symlink swap rather than a build.
#
# WHAT A WRONG ANSWER COSTS, and it is not symmetrical:
#
#   - Choosing a tree that does NOT carry this pin when one does: one run pays
#     what every run pays today. The ordinary price, not a failure.
#   - Choosing a tree and saying it carries this pin when it does not: the
#     build is skipped by `engine-series-stamp.sh` and a green check is
#     reported over code nothing compiled. That is the failure, and it is the
#     same one that script spends eleven of thirteen cases on.
#
# So this script never claims anything about a tree's contents. It picks a
# directory and points the path at it; what is IN that directory is still the
# stamp's question, asked afterward, against the tree the symlink now names.
# The cases below are about the picking and about the swap being real.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POOL_SH="$ROOT/.github/scripts/engine-tree-pool.sh"
[ -x "$POOL_SH" ] || { echo "no $POOL_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

# A build root with `slots` trees in it, none of them carrying anything. The
# real one is /build and a test has no business there, hence the seam.
build_root() { # slots
  local root slot
  root="$(mktemp -d "$WORK/build.XXXXXX")"
  mkdir -p "$root/trees"
  for slot in $(seq 0 $(($1 - 1))); do
    mkdir -p "$root/trees/tree-$slot/src"
  done
  printf '%s\n' "$root"
}

# What `engine-sync.sh` writes beside a checkout when its DEPS reach a pin.
# The pool reads that file and nothing else, so this is how a test says "this
# slot was last built at that pin".
carrying() { # root, slot, pin
  printf '%s\n' "$3" >"$1/trees/tree-$2/.domicile-synced-pin"
}

# When a slot was last handed out, backdated so the ordering is a fact rather
# than a race between two `touch`es in the same second.
used_at() { # root, slot, seconds ago
  local when
  when="$(date -d "@$(($(date +%s) - $3))" +%Y%m%d%H%M.%S)"
  touch -t "$when" "$1/trees/tree-$2/.domicile-last-used"
}

use() { # root, pin — output on stdout, status as the first line
  local out
  if out="$(DOMICILE_BUILD_ROOT="$1" "$POOL_SH" use "$2" 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }

# Which slot the path now names, as a slot number rather than a path, so the
# assertions read as the decision rather than as a temp directory.
chose() { # root
  local target
  target="$(readlink "$1/chromium" 2>/dev/null || true)"
  printf '%s\n' "${target##*/}"
}

echo "== a pin that has been built before is a swap, not a build =="

root="$(build_root 3)"
carrying "$root" 0 aaaaaaa
carrying "$root" 1 bbbbbbb
carrying "$root" 2 ccccccc
out="$(use "$root" bbbbbbb)"
expect "a slot carrying the pin is taken" ok "$(status "$out")"
expect "and it is the one that carries it" tree-1 "$(chose "$root")"
contains "and it says the build is the one being skipped" "already at bbbbbbb" "$out"

echo
echo "== a pin nobody has built takes the cheapest slot to lose =="

# An unbuilt slot costs nothing to take and a populated one costs its pin, so
# an empty slot goes first however long ago it was last handed out. Without
# this the first two pins evict each other while a whole tree sits unused.
root="$(build_root 3)"
carrying "$root" 0 aaaaaaa
used_at "$root" 0 99999
carrying "$root" 2 ccccccc
used_at "$root" 2 1
use "$root" ddddddd >/dev/null
expect "an empty slot is taken before a populated one" tree-1 "$(chose "$root")"

# THE CASE THE LAST-USED FILE EXISTS FOR. All three carry something, so one of
# them loses its pin; the one to lose is the one no branch has asked for in
# longest. Picking the first, or the newest, would throw away the tree the
# other open pull request is about to want.
root="$(build_root 3)"
carrying "$root" 0 aaaaaaa
used_at "$root" 0 60
carrying "$root" 1 bbbbbbb
used_at "$root" 1 99999
carrying "$root" 2 ccccccc
used_at "$root" 2 30
use "$root" ddddddd >/dev/null
expect "the least recently used slot is the one evicted" tree-1 "$(chose "$root")"

# A run that died between `engine-sync.sh` clearing that file and writing it
# again leaves a tree that is somewhere between two pins. It records no pin, so
# it reads as empty — which is right in both directions: it is the cheapest
# thing to take, and nothing will ever match it.
root="$(build_root 2)"
carrying "$root" 0 aaaaaaa
used_at "$root" 0 99999
use "$root" eeeeeee >/dev/null
expect "a slot that records no pin is free to take" tree-1 "$(chose "$root")"

echo
echo "== the swap has to be real, and it has to be seen =="

root="$(build_root 2)"
carrying "$root" 0 aaaaaaa
use "$root" aaaaaaa >/dev/null
expect "the path is a symlink" symlink \
  "$([ -L "$root/chromium" ] && echo symlink || echo "not a symlink")"
expect "and it reaches the slot's checkout" ok \
  "$([ -d "$root/chromium/src" ] && echo ok || echo "no src behind it")"

# Handing a slot out is what makes it recently used, and the file has to be
# written for the eviction above to have anything to sort on. A `use` that
# picks a slot and does not mark it would evict the tree it just filled.
root="$(build_root 2)"
use "$root" aaaaaaa >/dev/null
expect "the slot it hands out is marked used" ok \
  "$([ -f "$root/chromium/.domicile-last-used" ] && echo ok || echo "not marked")"

# Twice for the same pin is the ordinary case — every step of the engine job
# runs against a path that was already pointed here — and it must not become a
# different answer the second time.
root="$(build_root 2)"
carrying "$root" 0 aaaaaaa
use "$root" aaaaaaa >/dev/null
first="$(chose "$root")"
use "$root" aaaaaaa >/dev/null
expect "asking twice for the same pin does not move" "$first" "$(chose "$root")"

echo
echo "== what it refuses to do =="

# THE UN-ADOPTED MACHINE. Before the pool exists, /build/chromium is a real
# directory with 97G of Chromium in it. Replacing that with a symlink is not
# this script's to do: it is a move of the one tree on the machine, it belongs
# to whoever owns /build, and getting it wrong here costs four hours and is
# silent until the build starts. So it stops, and says which unit does it.
root="$(mktemp -d "$WORK/unadopted.XXXXXX")"
mkdir -p "$root/trees" "$root/chromium/src"
out="$(use "$root" aaaaaaa)"
expect "a real directory in the path's place is refused" refused "$(status "$out")"
contains "and the refusal says what has to happen to it" \
  "setup-chromium-trees" "$out"
expect "and nothing was moved" ok \
  "$([ -d "$root/chromium/src" ] && [ ! -L "$root/chromium" ] && echo ok || echo moved)"

# A MACHINE WITH NO POOL IS NOT A FAILURE, and this is the half that lets the
# two repositories land in either order. Until the unit that makes /build/trees
# is deployed there is nothing to choose between, and the run should build in
# the tree that is already there exactly as it did before.
root="$(mktemp -d "$WORK/nopool.XXXXXX")"
mkdir -p "$root/chromium/src"
out="$(use "$root" aaaaaaa)"
expect "no pool at all is not an error" ok "$(status "$out")"
contains "and it says why it did nothing" "no pool" "$out"
expect "and the checkout is untouched" ok \
  "$([ -d "$root/chromium/src" ] && echo ok || echo "it moved something")"

# An empty pool directory is a deploy half-done rather than no pool at all, and
# it must not read as one: `use` would otherwise silently leave the path
# wherever it was and the next run would build in a tree nobody chose.
root="$(mktemp -d "$WORK/emptypool.XXXXXX")"
mkdir -p "$root/trees"
out="$(use "$root" aaaaaaa)"
expect "a pool directory with no slots in it is refused" refused "$(status "$out")"
contains "and the refusal names the directory that is empty" "$root/trees" "$out"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "engine-tree-pool: all cases passed"
else
  echo "engine-tree-pool: $FAILED case(s) failed"
fi
exit "$FAILED"
