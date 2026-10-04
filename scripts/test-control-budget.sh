#!/usr/bin/env bash
# Tests `lib-control-budget.sh`, which sets how long a control waits.
#
# A guard stops when it sees its signal; its control must wait until it gives
# up. The guard records how long it took, and the control waits a multiple of
# that instead of a fixed timeout. A slow machine makes the guard slow, so the
# budget scales with it.
#
# Every rule below prevents a control from stopping too early:
#
# - No note means the full budget, so a control run alone keeps its timeout.
# - The budget never exceeds the full one.
# - A floor applies, so a 200ms guard does not yield an 800ms control.
# - A note must be recent: runners are not ephemeral and /tmp outlives a job.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-control-budget.sh"
[ -f "$LIB" ] || { echo "no $LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
# The cross-step case writes a note in the library's real directory, under a
# unique name, so clean that up too.
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

# The library explains itself on stderr so stdout stays a number. Keep it for
# the cases that read it.
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

# A stale 3s note would give this job's control a 12s budget. The note carries
# its own timestamp, so age it by rewriting that rather than the file's mtime.
# Reading an mtime needs `find -newermt` or `stat`, which the runner may lack.
printf '3\n%s\n' "$(($(date +%s) - 7200))" >"$WORK/shell"
expect "a note older than this job is not a measurement of it" \
  90 "$(budget shell 90)"

# A note from a run that died between its two lines. The missing timestamp must
# not be read as epoch zero or skipped.
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

# The runner has coreutils and little else (run 35475442242 failed on a missing
# `cmp`). The library uses only `date` and the note's own timestamp. Shadow
# `find` with a stub that exits 127, like a missing command, and check the
# answers do not change.
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

# The guard and control can run in separate `nix develop .#full --command`
# invocations (`pinned-engine.yml`, `engine-release.yml`, or by hand). Each
# invocation gets its own $TMPDIR (src/nix/develop.cc, makeRcScript):
#
#   export NIX_BUILD_TOP="$(mktemp -d -t nix-shell.XXXXXX)"
#   export TMPDIR="$NIX_BUILD_TOP"      # and TMP, TEMP, TEMPDIR
#
# So a note under $TMPDIR is never read, and the control spends its full
# budget. The framing guard and the client-window pair do not cover this: one
# stays in one process, the other's budget hits the ceiling either way.
#
# The library resolves its directory when sourced, so this needs two processes
# with different $TMPDIRs. $STEP is the step's $TMPDIR.
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

# A control that spends its full budget looks the same whether no note existed
# or it was written where the control cannot see it. Every answer says which.
rm -f "$WORK/shell"
: >"$SAID"
budget shell 90 >/dev/null
says "a control with no note to read says so" 'no note'

note shell 3
: >"$SAID"
budget shell 90 >/dev/null
says "and one with a note says what it read" '3s'

# --- the guards that are supposed to be using this ---------------------------

# The arithmetic above stays green if a guard stops calling the library. On
# engine run 35496858205 these guards' controls each spent a fixed timeout. A
# guard that asks but never writes a note gives its control the full budget.
GUARDS="$ROOT/packages/domicile-engine/scripts"
for guard in guard-client-window guard-shell guard-webview-framing \
  guard-shell-local-network \
  guard-webview-content-script guard-extension-installer \
  guard-extension-tray guard-webview-tabs guard-webview-active-tab \
  guard-webview-popup-window \
  guard-webview-passkey-extension; do
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

# The keyboard control has no budget. It must skip waiting for
# `GUARD guest-loaded`, which its <iframe> removes and its verdict never reads.
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
