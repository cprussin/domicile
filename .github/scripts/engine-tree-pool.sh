#!/usr/bin/env bash
# Which of `crux`'s Chromium trees this run builds in.
#
#   .github/scripts/engine-tree-pool.sh use  <pin>
#   .github/scripts/engine-tree-pool.sh list
#
# WHAT THIS IS FOR, in the numbers that made it worth writing. The checkout is
# keyed by `CHROMIUM_PIN`: `engine-reset.sh` puts it on that revision,
# `engine-sync.sh` moves its DEPS there, `apply.sh` lays the series over it,
# and `out/Domicile` then holds objects compiled against that revision. Moving
# the pin invalidates all of it — measured, run 35576710600: 4h05m.
#
# There was one tree, so the pin it carried was whichever branch ran last. Two
# pull requests on different pins do not interleave gracefully in one tree;
# they take turns, and every turn is that four hours IN BOTH DIRECTIONS,
# because going back to the older pin is as much of a rebuild as going forward
# was. Two branches, a pull request run and a merge run each, is four of them.
# The engine job is the most expensive thing in this repository and the machine
# has one slot for it, so those four hours are also the queue in front of
# everything else that wants `crux`.
#
# So: N trees behind one path. A pin that some tree already carries is a
# symlink swap and `engine-series-stamp.sh` then answers `carries=true`, which
# skips the reset, the apply and the compile — the ~1m case, for a pin that
# would otherwise have cost four hours. A pin nothing carries costs exactly
# what it costs today, in whichever tree was least recently asked for.
#
# THE PATH IS A SYMLINK AND EVERYTHING KEEPS SAYING /build/chromium/src. That
# is not tidiness. `gn gen` bakes absolute paths into `out/Domicile` — the
# ninja files, the command lines, the depfiles — so a tree that is reached at a
# different path is a tree whose every compile command changed, which is a
# clean build with extra steps. Behind one symlink every tree is built, read
# and cached at the same path, and the swap costs nothing. It is also why
# nothing here ever moves a tree that has been built in.
#
# WHAT THIS SCRIPT DOES NOT DO IS LOOK INSIDE A TREE. It picks a directory and
# points the path at it. Whether that directory really holds this pin's tree,
# this series, and a build of them is `engine-series-stamp.sh`'s question,
# asked afterward and against the tree the path now names. The division
# matters: a wrong pick here costs one run what every run cost before the pool
# existed, and a wrong *claim* about a tree's contents is a green check over
# code nothing compiled. This script is not in a position to make the second
# kind of mistake, and that is deliberate.
#
# THE POOL IS THE MACHINE'S, NOT THIS REPOSITORY'S. How many trees fit is a
# question about a ZFS quota on one machine in a house, so the slots are
# whatever directories `setup-chromium-trees.service` made
# (cprussin/dotfiles: config/machines/crux/chromium-build.nix). This script
# uses what it finds and never creates one: a slot appearing because a script
# guessed is 97G nobody planned for, on the dataset the machine's own builds
# live on.
set -u

usage() {
  echo "usage: $(basename "$0") <use|list> [pin]" >&2
  exit 2
}

action="${1:-}"
[ -n "$action" ] || usage

# /build on `crux`. A seam rather than a constant because the tests have no
# /build and should not want one, and because the whole of this script is
# decisions about directories.
ROOT="${DOMICILE_BUILD_ROOT:-/build}"
TREES="$ROOT/trees"
PATH_TO_TREE="$ROOT/chromium"

# What `engine-sync.sh` writes beside a checkout once its DEPS reach a pin, and
# the only thing here that says what a tree holds. Read rather than duplicated:
# a second file saying the same thing is a second file that can disagree, and
# the failure of disagreeing is a tree described as a pin it is not at.
#
# It is deliberately cleared for the length of a sync, so a run that died in
# one leaves a tree that reports nothing. That reads as free, which is right
# twice over: such a tree is genuinely between two pins so it can match
# nothing, and it is the cheapest thing in the pool to take.
slot_pin() { # slot directory
  cat "$1/.domicile-synced-pin" 2>/dev/null | tr -d '[:space:]'
}

# When a slot was last handed out. Not the mtime of the tree — a build writes
# into it constantly and a `git status` does not, so the tree's own timestamps
# answer "when was this compiled", which is a different question from "when did
# a branch last want this pin".
used_file() { printf '%s\n' "$1/.domicile-last-used"; }

slots() { find "$TREES" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort; }

# The slots there is anything to build in, which is not all of them. A slot the
# unit made and has not filled is an empty directory: the swap onto it succeeds
# and `engine-reset.sh` dies a second later on `cannot change to
# '/build/chromium/src'`, having built nothing. That happened on run
# 35703990131 and it was not one run's problem — the pick repeats for the same
# reason on the next one, so every branch fails the same way until the slot is
# filled.
#
# And filling one is not a job's to do. It is a `.gclient` and a from-scratch
# `gclient sync`: 97G and hours, on a dataset the machine's own builds live on.
# `setup-chromium-trees.service` (cprussin/dotfiles:
# config/machines/crux/chromium-build.nix) owns that, here as everywhere else
# in this script — so an unfilled slot is one this script passes over, and a
# pool of nothing but those is one it refuses.
#
# THIS IS NOT LOOKING INSIDE A TREE, which is the line the rest of the script
# holds. It asks whether there is a checkout at the path everything else says;
# which pin that checkout is on, which series is over it and whether either was
# compiled is still `engine-series-stamp.sh`'s question, asked afterward and
# against the tree the path names by then.
usable() {
  local slot
  for slot in $(slots); do
    if [ -d "$slot/src" ]; then
      printf '%s\n' "$slot"
    fi
  done
}

# The slot to give this pin, printed as a path. In order: the one that already
# carries it, then any that carries nothing, then the one no run has asked for
# in longest.
#
# "CARRIES NOTHING" IS ABOUT THE PIN AND NOT ABOUT THE TREE, and the two were
# one thing until run 35703990131 showed what that costs. A slot whose sync
# died between clearing the stamp and writing it again deliberately reports no
# pin, and it is both usable and the cheapest thing in the pool to take. A slot
# with no checkout in it reports no pin for a different reason and cannot be
# built in at all. Only the first is free; the second is not in `usable` and so
# is not in any of the three rules below.
#
# EMPTY BEFORE LEAST-RECENTLY-USED, and the order is the point rather than a
# tie-break. Taking a populated slot costs the pin it held — the next run that
# wants it pays four hours — and taking an empty one costs nothing at all. A
# rule that only sorted by age would evict a live pin while a whole tree sat
# unused, on a machine where the unused tree is the entire reason the pool was
# given the disk.
choose() { # pin
  local slot oldest oldest_at at
  for slot in $(usable); do
    [ "$(slot_pin "$slot")" = "$1" ] || continue
    printf '%s\n' "$slot"
    return 0
  done
  for slot in $(usable); do
    [ -z "$(slot_pin "$slot")" ] || continue
    printf '%s\n' "$slot"
    return 0
  done
  oldest=""
  oldest_at=""
  for slot in $(usable); do
    # A slot that has never been handed out sorts oldest, which it is.
    at="$(stat -c %Y "$(used_file "$slot")" 2>/dev/null || echo 0)"
    if [ -z "$oldest_at" ] || [ "$at" -lt "$oldest_at" ]; then
      oldest="$slot"
      oldest_at="$at"
    fi
  done
  printf '%s\n' "$oldest"
}

case "$action" in
  use)
    pin="${2:-}"
    [ -n "$pin" ] || usage

    if [ ! -d "$TREES" ]; then
      # THE HALF THAT LETS THE TWO REPOSITORIES LAND IN EITHER ORDER. The unit
      # that makes this directory is in cprussin/dotfiles, and until it is
      # deployed there is nothing to choose between. A run on such a machine
      # should do exactly what every run did before this script existed: build
      # in the tree that is there.
      echo "no pool at $TREES, so this run builds in $PATH_TO_TREE as it is"
      exit 0
    fi

    if [ -z "$(slots)" ]; then
      # And this is NOT that case, which is why it is asked separately. The
      # directory exists, so the unit ran; it has nothing in it, so the unit
      # did not finish. Reading that as "no pool" would leave the path wherever
      # the last run left it and build against a pin nobody chose.
      {
        echo "::error::$TREES exists but holds no tree, so there is nothing to build in"
        echo "setup-chromium-trees.service (cprussin/dotfiles) is what fills it."
      } >&2
      exit 1
    fi

    if [ -e "$PATH_TO_TREE" ] && [ ! -L "$PATH_TO_TREE" ]; then
      # THE MACHINE THAT HAS NOT BEEN ADOPTED YET. Before the pool, this path
      # is a real directory with the one Chromium tree in it. Turning that into
      # a symlink means moving 97G, and it belongs to whoever owns /build
      # rather than to a script that runs inside a job: done here it would
      # happen under whatever else is in that tree, and the first symptom would
      # be a build four hours long.
      {
        echo "::error::$PATH_TO_TREE is a directory, not a symlink into $TREES"
        echo "The pool cannot point a path that is already a tree. Moving that"
        echo "tree into a slot is setup-chromium-trees.service's job"
        echo "(cprussin/dotfiles: config/machines/crux/chromium-build.nix), and"
        echo "it is a move of the only Chromium checkout on this machine."
      } >&2
      exit 1
    fi

    if [ -z "$(usable)" ]; then
      # Slots, and nothing in any of them — the same deploy half-done as the
      # case above, one step further along. Said separately because the fix is
      # different: there the unit has not made the directories, here it has
      # made them and not filled them, and a reader who has just been told the
      # pool is empty while `ls` shows three trees in it is being told the
      # wrong thing.
      {
        echo "::error::no tree under $TREES holds a Chromium checkout, so there is nothing to build in"
        echo "Each slot is an empty directory: there is no src/ under any of them."
        echo "Filling one is a .gclient and a from-scratch gclient sync — 97G and"
        echo "hours — which setup-chromium-trees.service (cprussin/dotfiles:"
        echo "config/machines/crux/chromium-build.nix) does and a job does not."
      } >&2
      exit 1
    fi

    slot="$(choose "$pin")"
    was="$(slot_pin "$slot")"

    # Replaced rather than repointed: `ln -sfn` onto an existing symlink to a
    # directory is the one form that does not put the new link *inside* the old
    # target, and it is still two operations. A temporary name and a rename is
    # one, and it is the one that cannot leave the path missing.
    ln -s "$slot" "$PATH_TO_TREE.new"
    mv -T "$PATH_TO_TREE.new" "$PATH_TO_TREE"

    # After the swap, so a run that dies in it does not leave a slot marked as
    # used by a run that never got it.
    touch "$(used_file "$slot")"

    if [ "$was" = "$pin" ]; then
      echo "$PATH_TO_TREE is ${slot##*/}, already at $pin: the reset, the sync, the apply and the compile have nothing to do"
    elif [ -z "$was" ]; then
      echo "$PATH_TO_TREE is ${slot##*/}, which carries no pin: this run builds $pin into it"
    else
      echo "$PATH_TO_TREE is ${slot##*/}, which was at $was: this run takes it to $pin, which is a rebuild"
    fi
    ;;

  list)
    [ -d "$TREES" ] || { echo "no pool at $TREES"; exit 0; }
    current="$(readlink "$PATH_TO_TREE" 2>/dev/null || true)"
    for slot in $(slots); do
      printf '%s\t%s\t%s\n' \
        "$([ "$slot" = "$current" ] && echo '*' || echo ' ')" \
        "${slot##*/}" \
        "$(slot_pin "$slot" || true)"
    done
    ;;

  *) usage ;;
esac
