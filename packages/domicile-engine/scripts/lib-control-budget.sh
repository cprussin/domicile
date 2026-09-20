#!/usr/bin/env bash
# How long a control waits for the thing that must not happen.
#
#   . "$SCRIPTS/lib-control-budget.sh"
#   budget_note client-window 4      # the guard saw its signal after 4s
#   budget_for client-window 60      # what its control should wait instead
#
# A guard and its control are the same run with one thing changed, and they
# cost very different amounts for a structural reason: the guard stops the
# moment it sees what it is looking for, and the control cannot stop until it
# has given up. So the control pays its whole timeout every single time.
# Measured on engine run 35496858205, on crux: 1m07 for the client-window guard
# against 2m04 for its control, 12s for the shell guard against 1m41 for its
# control, and 10m08 across the ten steps of the five pairs.
#
# THE NUMBER TO WAIT IS THE GUARD'S OWN. Those two run back to back, in one
# job, against one build, on one machine — so how long the guard took to see
# its signal is the best available statement of how long the control has to
# watch before an absence means anything. The guard writes it down here and
# the control reads it.
#
# This is not "a shorter constant". A constant has to be chosen for the slowest
# machine the guard will ever run on, and the control then pays that number on
# every machine. A multiple of the guard's own measurement rises when the
# machine is slow, which is the case the constant was picked to survive, and
# falls when it is not.
#
# EVERY WAY THIS CAN BE WRONG IS A CONTROL THAT STOPS WATCHING TOO EARLY, so
# each of them has a rule and `scripts/test-control-budget.sh` has a case:
#
#   - no note, no change: a control run on its own — by a person, or in a job
#     where the guard failed before it measured anything — waits exactly what
#     it waited before this file existed;
#   - never longer than the full budget, so this can only make a control
#     cheaper than the number somebody chose, never more patient than it;
#   - a floor, because a guard that answered in 200ms does not license a
#     control that watches for 800ms;
#   - and the note has to be recent. These runners are not ephemeral and /tmp
#     outlives a job, so a number from an earlier build is not a measurement of
#     this one and is ignored.

# WHERE THE NOTE GOES, AND WHY IT IS NOT $TMPDIR. A guard and its control run
# inside `nix develop .#full --command`, and there are callers where each of
# them is its OWN invocation of it: `pinned-engine.yml` and
# `engine-release.yml` each run one guard that way, and so does a person
# running one by hand. The rc script `nix develop` writes ends in
#
#   export NIX_BUILD_TOP="$(mktemp -d -t nix-shell.XXXXXX)"
#   export TMPDIR="$NIX_BUILD_TOP"      # and TMP, TEMP, TEMPDIR
#
# -- src/nix/develop.cc, makeRcScript -- so every invocation of it makes a
# directory of its own and the guard's $TMPDIR is never the control's. The
# first version of this file put the note under $TMPDIR, which wrote it where
# nothing would ever read it: both shell controls spent their full 90 polls on
# engine runs 35492633677 and 35529548154, exactly as they had before this
# existed. Only the framing guard's saving was real, and only because its
# control writes the note and reads it inside one process.
#
# /tmp is what two steps of one job do share. It is the runner unit's own --
# PrivateTmp is per-service and the service outlives every job it runs -- which
# is already how the guards hand their compositor and engine logs to
# `.github/scripts/engine-diagnostics.sh` a step later. Same channel, two lines
# instead of a log. What being per-unit rather than per-job costs is a note
# from the last job sitting there, and the staleness check below is what that
# is for; `engine.yml` empties the directory at the top of a run as well.
#
# AND IT STAYS PINNED EVEN THOUGH THE ENGINE GROUP NO LONGER NEEDS IT TO BE.
# `engine.yml` runs its seventeen checks as one `./scripts/check.sh engine` inside
# one `nix develop`, and `scripts/lib/engine-guard.sh` runs each guard and its
# control back to back in that one process tree -- so for that job the two now
# share a $TMPDIR as well as a /tmp, and either location would carry the note.
# That is not a reason to move it back. The other callers above are still one
# invocation per guard, and a note under $TMPDIR would be unreadable for them
# exactly as it was for every caller before: silently, by spending the full
# budget, which is the defect two engine runs could not tell from having nothing
# to read.
DOMICILE_CONTROL_BUDGET_DIR="${DOMICILE_CONTROL_BUDGET_DIR:-/tmp/domicile-control-budgets}"

# What a control is allowed to infer from the guard's measurement.
DOMICILE_CONTROL_BUDGET_MULTIPLE="${DOMICILE_CONTROL_BUDGET_MULTIPLE:-4}"
DOMICILE_CONTROL_BUDGET_FLOOR="${DOMICILE_CONTROL_BUDGET_FLOOR:-10}"
# Beyond this, a note is from another job. Ten minutes is longer than any
# guard-and-control pair in engine.yml and far shorter than the gap between
# runs on a machine with one of these queues in front of it.
DOMICILE_CONTROL_BUDGET_MAX_AGE="${DOMICILE_CONTROL_BUDGET_MAX_AGE:-600}"

# EVERY ANSWER SAYS WHICH ONE IT WAS, on stderr, because the number on stdout
# is the whole of what the caller reads and a fallback that says nothing is how
# this went wrong. Two engine runs carried a control that spent its full budget
# because its note was written into a directory the next step did not have, and
# nothing in either job's log distinguished that from a control that had
# nothing to be told. One line per answer, in the step that made it.
budget_said() { printf 'control budget: %s\n' "$*" >&2; }

# The guard saw its signal after $2 seconds. Called on the path that SUCCEEDS,
# because that is the only path whose timing says anything: a guard that timed
# out measured its own patience rather than the system's.
# Two lines: the measurement, then the clock when it was taken. The timestamp
# is IN the file rather than read off its mtime, because reading an mtime means
# `find -newermt` or `stat`, and what is on that runner's PATH is not something
# to assume -- the sibling change to engine-series-stamp.sh cost a red pull
# request to `cmp: command not found`, diffutils not being installed there.
# `date` and `printf` are coreutils, which everything on that machine already
# depends on.
budget_note() { # $1 name, $2 seconds
  local file="$DOMICILE_CONTROL_BUDGET_DIR/$1"
  mkdir -p "$DOMICILE_CONTROL_BUDGET_DIR" 2>/dev/null || {
    budget_said "$1: cannot make $DOMICILE_CONTROL_BUDGET_DIR, so its control" \
      "will get no measurement and spend its full budget"
    return 0
  }
  printf '%s\n%s\n' "$2" "$(date +%s)" >"$file" 2>/dev/null || {
    budget_said "$1: cannot write $file, so its control will get no" \
      "measurement and spend its full budget"
    return 0
  }
  budget_said "$1: the guard took ${2}s, written down in $file"
}

# What the control should wait, in seconds, given that $2 is what it used to.
# Prints a number and never fails: a budget this cannot compute is the full
# one, which is the behavior of every version of these guards before it.
budget_for() { # $1 name, $2 full budget in seconds
  local file noted written now budget
  file="$DOMICILE_CONTROL_BUDGET_DIR/$1"

  [ -f "$file" ] || {
    budget_said "$1: no note at $file, so nothing measured this and the" \
      "control spends its full ${2}s"
    printf '%s\n' "$2"
    return 0
  }

  noted="$(sed -n '1p' "$file" 2>/dev/null)"
  written="$(sed -n '2p' "$file" 2>/dev/null)"

  # Anything unreadable is not a measurement. Both fields are checked before
  # either is used, so a truncated file -- a note from a run that died between
  # the two lines -- lands on the full budget rather than on half a reading.
  case "$noted" in
    (''|*[!0-9]*)
      budget_said "$1: the note at $file reads '$noted' rather than a number," \
        "so the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac
  case "$written" in
    (''|*[!0-9]*)
      budget_said "$1: the note at $file was taken at '$written' rather than a" \
        "time, so the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac

  # Recent enough to be about this build. These runners are not ephemeral and
  # /tmp outlives a job, so a number from an earlier one is not a measurement
  # of this one. A clock that has gone backwards makes this negative, which is
  # not recent either and falls through to the full budget.
  now="$(date +%s)"
  case "$now" in
    (''|*[!0-9]*)
      budget_said "$1: the clock reads '$now', so the note cannot be dated and" \
        "the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac
  [ "$((now - written))" -ge 0 ] &&
    [ "$((now - written))" -le "$DOMICILE_CONTROL_BUDGET_MAX_AGE" ] || {
    budget_said "$1: the note at $file is $((now - written))s old, which is" \
      "another job's, so the control spends its full ${2}s"
    printf '%s\n' "$2"
    return 0
  }

  budget=$((noted * DOMICILE_CONTROL_BUDGET_MULTIPLE))
  [ "$budget" -ge "$DOMICILE_CONTROL_BUDGET_FLOOR" ] ||
    budget="$DOMICILE_CONTROL_BUDGET_FLOOR"
  [ "$budget" -le "$2" ] || budget="$2"
  budget_said "$1: the guard took ${noted}s" \
    "${DOMICILE_CONTROL_BUDGET_MULTIPLE}x that is" \
    "$((noted * DOMICILE_CONTROL_BUDGET_MULTIPLE))s," \
    "floor ${DOMICILE_CONTROL_BUDGET_FLOOR}s and ceiling ${2}s," \
    "so the control waits ${budget}s"
  printf '%s\n' "$budget"
}
