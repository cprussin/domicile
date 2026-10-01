#!/usr/bin/env bash
# Which of `crux`'s Chromium trees this run builds in.
#
#   .github/scripts/engine-tree-pool.sh pick <pin> <owner>
#   .github/scripts/engine-tree-pool.sh compiles <pin>
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
# So: N trees, and a run gets one of them. A pin that some tree already carries
# makes `engine-series-stamp.sh` answer `carries=true`, which skips the reset,
# the apply and the compile — the ~1m case, for a pin that would otherwise have
# cost four hours. A pin nothing carries costs exactly what it costs today, in
# whichever tree was least recently asked for.
#
# EVERY TREE IS NOW BUILT AT ITS OWN REAL PATH, AND THAT IS THE CHANGE THAT
# LETS TWO RUNS BUILD AT ONCE. This used to hand every run `/build/chromium`, a
# symlink swapped onto whichever tree the run wanted, so that `out/Domicile`
# was compiled, read and cached under one path no matter which tree held it —
# `gn gen` puts absolute paths into that directory, so a tree reached at a new
# path is a tree whose every compile command changed.
#
# One path is one run. Two jobs cannot both be `/build/chromium/src`, and two
# jobs is the whole point of a pool: without them a repin still blocks every
# other engine branch, it just blocks them from a different directory.
#
# So each slot is reached where it actually is, forever. That cost one rebuild
# per tree the day it landed, and nothing after: `/build/trees/tree-0` is a
# path nothing swaps. `/build/chromium` stays as a person's bookmark, which
# `use` below still points — nothing in CI reads it.
#
# WHAT THIS SCRIPT DOES NOT DO IS LOOK INSIDE A TREE. It picks a directory and
# names it. Whether that directory really holds this pin's tree, this series,
# and a build of them is `engine-series-stamp.sh`'s question, asked afterward
# and against the tree this named. The division matters: a wrong pick here
# costs one run what every run cost before the pool existed, and a wrong
# *claim* about a tree's contents is a green check over code nothing compiled.
# This script is not in a position to make the second kind of mistake, and that
# is deliberate. It reads the series stamp beside a tree only to rank the trees,
# and `compiles` reads it with the built stamp, and engine-series-diff.sh's
# answer, only to guess whether a run will compile and whether that is cold;
# `carries` and `warm` still check the tree the pick names.
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
  echo "usage: $(basename "$0") <pick|compiles|use|list> [pin] [owner]" >&2
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

# The series a slot last carried: line one of the stamp
# `engine-series-stamp.sh record` writes beside the checkout. A preference and
# never a claim -- whether the tree still carries it is `carries`'s question,
# asked after the pick, and a stale stamp here costs one ordinary rebuild.
slot_series() { # slot directory
  sed -n '1p' "$1/.domicile-series-stamp" 2>/dev/null
}

# When a slot was last handed out. Not the mtime of the tree — a build writes
# into it constantly and a `git status` does not, so the tree's own timestamps
# answer "when was this compiled", which is a different question from "when did
# a branch last want this pin".
used_file() { printf '%s\n' "$1/.domicile-last-used"; }

slots() { find "$TREES" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort; }

# The slots there is anything to build in, which is not all of them. A slot the
# unit made and has not filled is an empty directory: handing it out succeeds
# and `engine-reset.sh` dies a second later on `cannot change to
# '<slot>/src'`, having built nothing. That happened on run
# 35703990131 and it was not one run's problem — the pick repeats for the same
# reason on the next one, so every branch fails the same way until the slot is
# filled.
#
# And filling one is not a job's to do. It is a `.gclient` and a from-scratch
# `gclient sync`: 97G and hours, on a dataset the machine's own builds live on.
# `bootstrap-chromium-tree.service` (cprussin/dotfiles:
# config/machines/crux/chromium-build.nix) owns that on a timer, here as
# everywhere else in this script — so an unfilled slot is one this script
# passes over, and a pool of nothing but those is one it refuses.
#
# TWO UNITS, AND THE SPLIT IS WHAT EACH MESSAGE BELOW HAS TO GET RIGHT:
# `setup-chromium-trees.service` makes the slots and adopts the one checkout
# the machine already had; `bootstrap-chromium-tree.service` puts a checkout
# into a slot that has none.
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

# The slot to give this pin, printed as a path. In order: one at the pin whose
# stamp names this run's series, then the rest at the pin least recently used
# first, then any that carries nothing, then the one no run has asked for in
# longest.
#
# THE SERIES BEFORE THE PIN, because the pin alone let two pull requests at one
# pin swap trees: run 36228817911 rebuilt in tree-1 the series 36223658113 had
# just built in tree-0. A series match skips the reset, the apply and the
# compile; a pin match skips only the sync. And among trees at the pin, the one
# evicted is the one asked for longest ago rather than the first by name, which
# is the series least likely to be wanted next. The stamp holds a hash, so
# "shares the most" stops at the pin: no branch or pull request is written
# beside a tree to compare.
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
# EVERY usable slot, best first, rather than only the best one. `use` wants
# the first line and `pick` wants the whole list: when the best tree is already
# held by another run, the next-best is the answer, and a function that
# returned one slot could not say what it was.
candidates() { # pin series
  local slot at
  for slot in $(usable); do
    [ "$(slot_pin "$slot")" = "$1" ] || continue
    [ "$(slot_series "$slot")" = "$2" ] || continue
    printf '%s\n' "$slot"
  done
  for slot in $(usable); do
    [ "$(slot_pin "$slot")" = "$1" ] || continue
    [ "$(slot_series "$slot")" = "$2" ] && continue
    at="$(stat -c %Y "$(used_file "$slot")" 2>/dev/null || echo 0)"
    printf '%s %s\n' "$at" "$slot"
  done | LC_ALL=C sort -n | cut -d' ' -f2-
  for slot in $(usable); do
    [ "$(slot_pin "$slot")" = "$1" ] && continue
    [ -z "$(slot_pin "$slot")" ] || continue
    printf '%s\n' "$slot"
  done
  # The rest, least recently used first. A slot never handed out has no
  # timestamp and sorts oldest, which it is.
  for slot in $(usable); do
    [ "$(slot_pin "$slot")" = "$1" ] && continue
    [ -z "$(slot_pin "$slot")" ] && continue
    at="$(stat -c %Y "$(used_file "$slot")" 2>/dev/null || echo 0)"
    printf '%s %s\n' "$at" "$slot"
  done | LC_ALL=C sort -n | cut -d' ' -f2-
}

choose() { # pin series
  candidates "$1" "$2" | head -1
}

# This run's series, from the script whose stamps it is compared against, so
# the two cannot mean different things. Asked once, outside any `$(...)` loop,
# so a failure stops the run instead of reading as "no tree matches".
STAMP_SH="$(cd "$(dirname "$0")" && pwd)/engine-series-stamp.sh"

# THE LOCK IS engine-tree-lock.sh's, NOT A SECOND ONE. That script already
# names, takes and drops a per-tree lock, and it is what a person and the
# `if: always()` drop step use. A copy of the mechanism here would be a second
# thing to keep true about the same directory, and the failure of the two
# disagreeing is two runs in one tree -- the exact corruption both exist for.
#
# Its stderr is discarded while walking candidates: a held tree is the ordinary
# case here, not an error, and its refusal block is written for a run that has
# nowhere left to go. This one says that itself, once, at the end.
LOCK_SH="$(cd "$(dirname "$0")" && pwd)/engine-tree-lock.sh"

# Whether a tree's out/Release is built from what it carries: the compile
# slot's own `warm`, so the two cannot disagree.
SLOT_SH="$(cd "$(dirname "$0")" && pwd)/engine-compile-slot.sh"

# What this series would change in a tree, for `compiles`. Override for tests.
DIFF_SH="${DOMICILE_SERIES_DIFF:-$(cd "$(dirname "$0")" && pwd)/engine-series-diff.sh}"

# Files whose change recompiles much of Chromium: headers, and what generates
# them (mojom, IDL, blink's json5 tables) or configures many targets (gni).
WIDELY_INCLUDED='\.(h|hh|hpp|inc|def|mojom|idl|json5|gni)$'

# Whether a compile in <slot> of this series is cold, printing why when it is.
#
# WARM IS AN INCREMENTAL BUILD THAT CCACHE COVERS: a tree at this pin whose
# out/Release is built from the series it carries, which this series changes
# in sources only. ccache with CCACHE_BASEDIR/NOHASHDIR hits 95-100% on such a
# build; one after a widely included header changed hits 1-6% and takes over
# an hour. It does not count what includes a header -- that is the build
# graph's to say, and no header this series changes is the proxy. Everything
# else is cold. A wrong answer changes the queue and never what is built.
cold_because() { # slot pin
  local changed wide
  if [ "$(slot_pin "$1")" != "$2" ]; then
    echo "it is at another pin"
  elif [ "$(GITHUB_OUTPUT=/dev/stdout "$SLOT_SH" warm "$1/src")" != "warm=true" ]; then
    echo "its out/Release is not built from what it carries"
  elif ! changed="$("$DIFF_SH" "$1/src")"; then
    echo "what this series changes in it could not be read"
  elif wide="$(printf '%s\n' "$changed" | grep -E "$WIDELY_INCLUDED")"; then
    echo "this series changes $(printf '%s\n' "$wide" | wc -l) widely included file(s), $(printf '%s\n' "$wide" | head -1) first"
  else
    return 1
  fi
}

take_slot() { # slot owner
  "$LOCK_SH" take "$1/src" "$2" >/dev/null 2>&1
}

holder_of() { # slot
  cat "$("$LOCK_SH" path "$1/src")/owner" 2>/dev/null ||
    echo "someone who did not write their name in it"
}

case "$action" in
  pick)
    pin="${2:-}"
    owner="${3:-}"
    [ -n "$pin" ] && [ -n "$owner" ] || usage

    if [ ! -d "$TREES" ] || [ -z "$(slots)" ] || [ -z "$(usable)" ]; then
      # The same three half-deployed machines `use` answers for, with the same
      # answers. Kept as one branch because `pick` has nothing to point at and
      # so cannot fall back to "build in whatever is there" the way `use` can.
      {
        echo "::error::no usable Chromium tree to pick from under $TREES"
        echo "setup-chromium-trees.service (cprussin/dotfiles) makes the slots"
        echo "and bootstrap-chromium-tree.service fills them."
      } >&2
      exit 1
    fi

    # A run from a workflow older than per-tree locks holds this one lock and
    # repoints /build/chromium into any tree, so while it exists none is free.
    if [ -d "$ROOT/.domicile-tree-lock" ]; then
      {
        echo "::error::'$(cat "$ROOT/.domicile-tree-lock/owner" 2>/dev/null || echo someone)' holds the pre-pool lock at $ROOT/.domicile-tree-lock and may reset any tree"
        echo "Wait for it and re-run. If it is stale: rm -rf $ROOT/.domicile-tree-lock"
      } >&2
      exit 1
    fi

    series="$("$STAMP_SH" identity)" || exit 1
    take_best() {
      local slot
      for slot in $(candidates "$pin" "$series"); do
        if take_slot "$slot" "$owner"; then
          touch "$(used_file "$slot")"
          printf '%s\n' "$slot/src"
          return 0
        fi
      done
      return 1
    }
    take_best && exit 0

    # EVERY TREE IS HELD, which is a queue rather than a fault: the machine has
    # as many trees as it has, and a run that cannot have one waits for the
    # next. Refusing instead was a red check per run that lost the race --
    # PR #794's build failed three times in an afternoon on trees that freed
    # minutes later.
    #
    # BUT ONLY ONE RUN WAITS. A waiting build holds one of crux's two runners,
    # and a tree is dropped only by its run's engine job, which needs a runner
    # too. Two waiters hold both and nothing can ever drop a tree. One waiter
    # leaves a runner for the holders' engine jobs to take in turn, so this
    # always ends. The waiter says it is alive every poll, so one that was
    # canceled stops counting within WAITER_STALE.
    #
    # FORTY-FIVE MINUTES, because it is spent from the build job's budget
    # before the compile slot's wait and a cold repin, and those two leave 51
    # (scripts/test-the-engine-budget-holds-both-builds.sh). A warm holder
    # drops its tree well inside that; one doing a cold repin will not, and
    # this run is red behind it as it always was.
    WAIT="${DOMICILE_TREE_WAIT:-2700}"
    POLL="${DOMICILE_TREE_POLL:-15}"
    WAITER_STALE="${DOMICILE_TREE_WAITER_STALE:-120}"
    WAITER="$ROOT/.domicile-tree-waiter"
    holders() {
      local slot
      for slot in $(usable); do
        echo "  $(basename "$slot"): $(holder_of "$slot")"
      done
      echo
      echo "Wait and re-run -- a Chromium build is up to four hours. If a"
      echo "holder is a run that died, its lock is stale and this clears it:"
      echo
      echo "  rm -rf $("$LOCK_SH" path "$(usable | head -1)/src")"
    }
    if [ "$WAIT" -le 0 ]; then
      {
        echo "::error::every Chromium tree under $TREES is held, so this run has nowhere to build"
        holders
      } >&2
      exit 1
    fi
    if ! mkdir "$WAITER" 2>/dev/null; then
      if [ -n "$(find "$WAITER" -newermt "-$WAITER_STALE seconds" 2>/dev/null)" ]; then
        {
          echo "::error::every Chromium tree under $TREES is held, and '$(cat "$WAITER/owner" 2>/dev/null)' is already waiting for one"
          echo "A second waiter would hold the runner a holder needs to drop its tree."
          holders
        } >&2
        exit 1
      fi
      echo "::warning::'$(cat "$WAITER/owner" 2>/dev/null)' stopped saying it was waiting for a tree; waiting in its place" >&2
      rm -rf "$WAITER"
      mkdir "$WAITER" || exit 1
    fi
    trap 'rm -rf "$WAITER"' EXIT
    printf '%s\n' "$owner" >"$WAITER/owner"
    touch "$WAITER/alive"
    echo "every Chromium tree under $TREES is held; waiting up to ${WAIT}s for one" >&2
    waited=0
    asked=0
    while [ "$waited" -lt "$WAIT" ]; do
      sleep "$POLL"
      waited=$((waited + POLL))
      touch "$WAITER/alive"
      # Whether this run is still worth a tree, asked the way the compile
      # slot's waiters ask (engine-compile-slot.sh): exit 0 yes, 1 no, anything
      # else could not ask. A run whose commit was replaced holds the one
      # waiting place for nothing; a check that cannot answer is not a no.
      if [ -n "${DOMICILE_TREE_STILL_WANTED:-}" ] &&
         [ $((waited - asked)) -ge "${DOMICILE_TREE_RECHECK:-60}" ]; then
        asked="$waited"
        why="$(sh -c "$DOMICILE_TREE_STILL_WANTED" 2>&1)"
        case $? in
          0) ;;
          1)
            echo "::error::no longer waiting for a tree: $why" >&2
            [ -z "${GITHUB_OUTPUT:-}" ] || echo "superseded=true" >>"$GITHUB_OUTPUT"
            exit 1
            ;;
          *) echo "could not ask whether this run is still wanted, so it carries on: $why" >&2 ;;
        esac
      fi
      if take_best; then
        echo "took a tree after ${waited}s" >&2
        exit 0
      fi
    done
    {
      echo "::error::every Chromium tree under $TREES was still held after waiting ${waited}s, so this run has nowhere to build"
      holders
    } >&2
    exit 1
    ;;

  compiles)
    # WHETHER THE TREE `pick` WOULD TAKE NOW NEEDS A COMPILE, asked before the
    # build job takes a runner: engine.yml queues a run that compiles on
    # GitHub for the compile slot, where waiting holds no runner. Writes
    # `compile=false` only for a free tree whose stamp names this series and
    # whose out/Release was built from it -- the two answers the job's own
    # `carries` and `warm` steps give before skipping the slot. Anything else
    # is `compile=true`, and so is a plan that fails, in engine.yml: that
    # queues the run, which costs it a wait and nobody else a runner. A guess that
    # goes stale before the job runs is caught by the job, which still takes
    # the slot. It locks nothing.
    #
    # AND WHETHER THAT COMPILE IS COLD, as `cold=true|false`, so engine.yml
    # can queue a cold compile apart from the warm ones. See `cold_because`.
    # With no free tree to ask about, it is cold: that is the queue whose runs
    # step aside for the others, so a wrong `true` costs only this run.
    pin="${2:-}"
    [ -n "$pin" ] || usage
    series="$("$STAMP_SH" identity)" || exit 1
    compile=true
    cold=true
    for slot in $(candidates "$pin" "$series"); do
      [ -d "$("$LOCK_SH" path "$slot/src")" ] && continue
      if [ "$(slot_series "$slot")" = "$series" ] &&
         [ "$(GITHUB_OUTPUT=/dev/stdout "$SLOT_SH" warm "$slot/src")" = "warm=true" ]; then
        compile=false
      fi
      if [ "$compile" = false ]; then
        cold=false
        why="it compiles nothing"
      elif why="$(cold_because "$slot" "$pin")"; then
        cold=true
      else
        cold=false
        why="it recompiles only sources this series changes"
      fi
      echo "the pick would take ${slot##*/}: compile=$compile cold=$cold, because $why"
      break
    done
    echo "compile=$compile" >>"${GITHUB_OUTPUT:-/dev/stdout}"
    echo "cold=$cold" >>"${GITHUB_OUTPUT:-/dev/stdout}"
    ;;

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
        echo "::error::$TREES exists but holds no slot, so there is nothing to build in"
        echo "setup-chromium-trees.service (cprussin/dotfiles) is what makes them."
        echo "Filling one is bootstrap-chromium-tree.service's, and it has nothing"
        echo "to fill yet."
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
        echo "hours — which bootstrap-chromium-tree.service (cprussin/dotfiles:"
        echo "config/machines/crux/chromium-build.nix) does on a timer, and a job"
        echo "does not.  It fires 30 minutes after a boot or a deploy and then"
        echo "daily; journalctl -u bootstrap-chromium-tree says what it last did."
      } >&2
      exit 1
    fi

    series="$("$STAMP_SH" identity)" || exit 1
    slot="$(choose "$pin" "$series")"
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
