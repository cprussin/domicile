#!/usr/bin/env bash
# How long a control waits for something that must not happen, asserted.
#
# A guard and its control are the same run with one thing changed, and they
# cost wildly different amounts for a reason that is structural rather than
# accidental: the guard stops the moment it sees what it is looking for, and
# the control cannot stop until it has given up. Measured on engine run
# 35496858205, the five pairs that do this are 10m08 of the job:
#
#   A client's window on the page            1m07   the guard
#   The guard can still fail                 2m04   its control
#   A shell on the fork ...                  0m12   the guard
#   The shell guard is looking at the pixels 1m41   its control
#
# The control's patience was a constant -- 60 polls, 90 polls, `--for-seconds`
# -- chosen as "long enough on a slow machine" for the GUARD. The control pays
# that number every single time, because nothing is ever going to arrive.
#
# WHAT REPLACES IT IS THE GUARD'S OWN MEASUREMENT. The two run back to back, in
# the same job, against the same build, on the same machine, so how long the
# guard took to see its signal is the best available statement of how long the
# control should wait to be sure it will not. The guard writes that number
# down; the control multiplies it and waits that long instead.
#
# This is not a shorter constant. On a slow machine the guard is slow, so the
# control's budget goes up with it -- which a constant cannot do, and which is
# the case a constant is chosen to survive.
#
# THE FOUR THINGS IT HAS TO GET RIGHT, and all four are ways to be wrong in the
# direction of a control that stops watching too early:
#
# - no note means the full budget, so a control run on its own -- by a person,
#   or by a job where the guard failed before it could measure -- is exactly as
#   patient as it was before this existed;
# - the budget never exceeds the full one, so this can only ever make a control
#   cheaper and never make it wait longer than the number somebody chose;
# - a floor, because a guard that answered in 200ms does not license a control
#   that watches for 800ms;
# - a note has to be recent, because these runners are not ephemeral and /tmp
#   outlives a job. A number from a build two hours ago is not a measurement of
#   this one.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-control-budget.sh"
[ -f "$LIB" ] || { echo "no $LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
# The cross-step case below writes a note where the library really puts one,
# under a name nothing else uses, so this takes that back too.
CROSSING="control-budget-test-$$"
trap 'rm -rf "$WORK"; rm -f "/tmp/domicile-control-budgets/$CROSSING"' EXIT
export DOMICILE_CONTROL_BUDGET_DIR="$WORK"

# shellcheck source=/dev/null
. "$LIB"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
says() { # what, pattern
  if grep -q "$2" "$SAID"; then ok "$1"; else
    printf '  FAIL  %s\n    nothing matching: %s\n    it said:\n%s\n' \
      "$1" "$2" "$(sed 's/^/      /' "$SAID")"
    FAILED=$((FAILED + 1))
  fi
}

# What the library explains goes to stderr, so the number on stdout stays a
# number a `$(...)` can use. Kept rather than printed, because the cases below
# read it.
SAID="$WORK/said"
: >"$SAID"
budget() { budget_for "$@" 2>>"$SAID"; }
note() { budget_note "$@" 2>>"$SAID"; }

# --- nothing measured --------------------------------------------------------

expect "with no note, a control is as patient as it always was" \
  90 "$(budget shell 90)"

# --- a guard that answered quickly ------------------------------------------

note shell 3
expect "a guard that answered in 3s buys the control 4x that" \
  12 "$(budget shell 90)"

# --- the floor ---------------------------------------------------------------

note shell 0
expect "a guard that answered immediately still leaves a floor" \
  10 "$(budget shell 90)"
note shell 1
expect "and just under the floor is still the floor" \
  10 "$(budget shell 90)"

# --- the ceiling -------------------------------------------------------------

note shell 40
expect "a slow guard never makes the control slower than it was" \
  90 "$(budget shell 90)"
note shell 1000
expect "and an absurd measurement cannot either" \
  90 "$(budget shell 90)"

# --- one guard's measurement is not another's --------------------------------

note shell 3
note client-window 20
expect "each guard's note is its own (shell)" 12 "$(budget shell 90)"
expect "each guard's note is its own (client-window)" 80 "$(budget client-window 90)"

# --- a note from a previous job ---------------------------------------------

# THE RUNNERS ARE NOT EPHEMERAL and /tmp outlives a job, so this is the case
# that turns a saving into a wrong answer: a 3s note from a build two hours ago
# would hand today's control a 12s budget on evidence about something else.
# Aged by rewriting the timestamp the note carries, not by touching the file.
# The note records when it was taken rather than relying on its own mtime,
# because reading an mtime costs `find -newermt` or `stat` and what is on that
# runner's PATH is not something to assume -- see the no-find case below.
printf '3\n%s\n' "$(($(date +%s) - 7200))" >"$WORK/shell"
expect "a note older than this job is not a measurement of it" \
  90 "$(budget shell 90)"

# A note from a run that died between its two lines. Half a reading is not a
# reading, and the missing half must not be read as "taken at epoch zero" --
# which would be stale, right for the wrong reason -- nor skipped.
printf '3\n' >"$WORK/shell"
expect "a note that was never finished is not a measurement either" \
  90 "$(budget shell 90)"

# --- a note that is not a number --------------------------------------------

printf 'not-a-number\n%s\n' "$(date +%s)" >"$WORK/shell"
expect "a note that is not a number is not a measurement either" \
  90 "$(budget shell 90)"

printf '3\nnot-a-timestamp\n' >"$WORK/shell"
expect "nor is one whose timestamp is not a number" \
  90 "$(budget shell 90)"

# --- the tools this is allowed to assume ------------------------------------

# THE RUNNER HAS COREUTILS AND NOT MUCH ELSE, and this file learned that from
# the sibling change rather than from first principles. `engine-series-stamp.sh`
# compared files with `cmp`, `cmp` is diffutils, diffutils is not on that unit's
# PATH, and run 35475442242 failed with `cmp: command not found` after a
# 35-patch series had applied cleanly.
#
# The staleness check here used `find -newermt`, which is a GNU extension of a
# tool nothing else on that machine invokes with that flag. Rather than bet on
# it, the note carries its own timestamp and `date` reads the clock -- both
# coreutils, both already used by every script on that runner. This case is
# what holds that: `find` is shadowed with a stub that exits 127 the way a
# missing command does, and the answers must not change.
NOFIND="$WORK/no-find"
mkdir -p "$NOFIND"
printf '#!/bin/sh\nexit 127\n' >"$NOFIND/find"
chmod +x "$NOFIND/find"
PATH="$NOFIND:$PATH"

note shell 3
expect "a fresh note is read without find on PATH" 12 "$(budget shell 90)"

printf '3\n%s\n' "$(($(date +%s) - 7200))" >"$WORK/shell"
expect "and a stale one is still rejected without find" 90 "$(budget shell 90)"

# --- the two steps of one job ------------------------------------------------

# WHERE THE NOTE GOES IS THE WHOLE POINT, and it is what this got wrong. A
# guard and its control are two steps of one job, and on the runner each step
# is its own `nix develop .#full --command`. The rc script `nix develop` writes
# ends in
#
#   export NIX_BUILD_TOP="$(mktemp -d -t nix-shell.XXXXXX)"
#   export TMPDIR="$NIX_BUILD_TOP"      # and TMP, TEMP, TEMPDIR
#
# -- src/nix/develop.cc, makeRcScript -- so every invocation of it gets a
# directory of its own and the guard's $TMPDIR is never the control's. A note
# written under $TMPDIR is written where nothing will read it, the control
# lands on "no measurement to hand", and it spends its full budget in silence.
# Measured on engine runs 35492633677 and 35529548154: both shell controls
# spent all 90 polls with the change in, the same as without it.
#
# The framing guard looked like proof that this worked and was not: its control
# writes the note in its permitted leg and reads it in its refused leg, both
# inside one process, so it never crosses a step at all. Nor does the
# client-window pair settle it -- four times its guard's minute is past the
# ceiling, so the capped answer and the no-note answer are the same number.
#
# Two processes with two different $TMPDIRs, because the directory is resolved
# when the library is sourced and a same-process case would not touch it.
# $STEP is the step's $TMPDIR. The library is sourced inside, because that is
# when it decides where a note lives.
in_a_step() {
  env -u DOMICILE_CONTROL_BUDGET_DIR TMPDIR="$STEP" \
    bash -c '. "$1"; shift; "$@"' bash "$LIB" "$@" 2>>"$SAID"
}

STEP="$WORK/step-one"
mkdir -p "$STEP"
in_a_step budget_note "$CROSSING" 3

STEP="$WORK/step-two"
mkdir -p "$STEP"
expect "the note the guard wrote is there for the control in the next step" \
  12 "$(in_a_step budget_for "$CROSSING" 90)"

# --- and it says which it was ------------------------------------------------

# A CONTROL THAT SPENDS ITS FULL BUDGET LOOKS THE SAME either way -- because
# nothing was measured, or because the measurement was written somewhere the
# control cannot see -- and the run log said neither. That silence is what let
# the defect above survive two engine runs and a reading of the source. So
# every answer names itself.
rm -f "$WORK/shell"
: >"$SAID"
budget shell 90 >/dev/null
says "a control with no note to read says so" 'no note'

note shell 3
: >"$SAID"
budget shell 90 >/dev/null
says "and one with a note says what it read" '3s'

# --- the guards that are supposed to be using this ---------------------------

# A LIBRARY NOTHING CALLS IS A SAVING THAT QUIETLY WENT AWAY. Every assertion
# above is about arithmetic, and all of it stays green if a guard stops asking.
# These are the controls measured burning a fixed timeout on engine run
# 35496858205; each has to both source this and ask it something, and the positive
# path has to write the note the control reads — a guard that only ever asks
# gets the full budget forever and looks exactly like this working.
GUARDS="$ROOT/packages/domicile-engine/scripts"
for guard in guard-client-window guard-shell guard-webview-framing; do
  file="$GUARDS/$guard.sh"
  if [ ! -f "$file" ]; then
    printf '  FAIL  %s is a guard this repository has
' "$guard"
    FAILED=$((FAILED + 1))
    continue
  fi
  for call in budget_for budget_note; do
    if grep -q "$call" "$file"; then
      ok "$guard calls $call"
    else
      printf '  FAIL  %s calls %s
    its control is back to spending a fixed timeout
' \
        "$guard" "$call"
      FAILED=$((FAILED + 1))
    fi
  done
done

# The keyboard control is the other shape and has no budget: it was waiting for
# `GUARD guest-loaded`, which its own <iframe> removes and which its verdict
# never reads. There is nothing to calibrate, only a wait to not do — so what
# is asserted is that the wait is conditional rather than that a number moved.
keyboard="$GUARDS/guard-webview-keyboard.sh"
if grep -B4 'wait_for_line "$TRIES" "GUARD guest-loaded"' "$keyboard" |
     grep -q 'NEGATIVE.*!= *"1"'; then
  ok "the keyboard control does not wait for the guest its <iframe> removed"
else
  printf '  FAIL  the keyboard control does not wait for the guest its <iframe> removed
'
  FAILED=$((FAILED + 1))
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
