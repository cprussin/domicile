#!/usr/bin/env bash
# WHICH drawn color ends `guard-client-window.sh`'s poll, asserted.
#
# WHAT THIS IS ABOUT. The guard asserts one thing: that a Wayland client's own
# window reaches the page in the CLIENT's own color. Its poll used to break on
# the first `engine drew #XXXXXXXX` line whatever that line said -- and the
# probe behind those lines runs on the submit path, inside `publish_frame`,
# where it samples the center of the browser's window as it stands at that
# moment. The client's surface has not necessarily been aggregated into the
# frame yet, so the first thing the probe reports is routinely the PAGE's own
# paint. Measured off the compositor log of engine run 35678987261 attempt 1:
#
#   57.501  the engine took this app's first frame
#   57.530  engine drew #FFFFFFFF          <- the page's own paint
#   57.806  embedding "app-1"
#   57.823  embedded "app-1"
#   57.836  engine drew #FF3F51B5          <- the page's indigo background,
#                                             13ms AFTER the embed
#
# The poll read #FFFFFFFF, priced the page's own paint as the client's answer,
# and the guard called a working seam broken. `WAITED` was 1 out of a `LOOKS`
# budget of 240, so this was never patience running out -- #490 raised that
# budget for a real and different reason and could not help here, because the
# loop exited after one second. It went red three times this way: twice on
# #478 (run 35678987261 attempt 1 reporting #FF3F51B5, run 35681207518
# reporting #FFFFFFFF) and once on #479's branch, where the commit message
# wrote the diagnosis down and left the fix for its own branch. Roughly a coin
# flip per run, on every pull request touching `packages/domicile-engine`.
#
# SO THE POLL WAITS FOR THE COLOR IT IS ASSERTING, and the cases below are the
# run that used to lose, the bound that makes it safe to wait for one color,
# and the measurement the poll is allowed to write down.
#
# THE MEASUREMENT IS THE SECOND HALF OF THE SAME DEFECT. `budget_note` is what
# a control reads to decide how long an absence has to last before it means
# anything, and `lib-control-budget.sh` exists to keep a guard's own exhausted
# patience out of it. A poll that keeps the last color it saw ends a timed-out
# run with the page's color in `DRAWN`, so a note guarded on "did we see
# anything" would write the timeout down as a reading and shorten the next
# control against it.
#
# The poll is run out of the real script rather than copied, as
# `test-the-client-window-guard-outwaits-a-busy-card.sh` does with the same
# block, so a rewrite that moves it fails here loudly instead of leaving this
# passing against a version nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The real `budget_note`, so a block that stops calling it fails here rather
# than against a stub that agrees with whatever it does.
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$ROOT/packages/domicile-engine/scripts/lib-control-budget.sh"

FAILED=0
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# --- the poll itself ---------------------------------------------------------

# From `DRAWN=""` to the `fi` that ends the note it writes down, which is the
# same slice the busy-card test takes. Both ends are whole lines, so this
# cannot half-match.
BLOCK="$(awk '/^DRAWN=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no draw poll in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# What the client draws, and what the guard is therefore asserting. Read out of
# the guard rather than spelled again, because the whole claim here is that the
# poll waits for THIS color.
CLIENT="$(sed -n 's/^COLOR="${COLOR:-\([0-9A-F]*\)}"$/\1/p' "$GUARD")"
case "$CLIENT" in
  (''|*[!0-9A-F]*)
    echo "no client color in $GUARD — read '$CLIENT'. Fix this test with it." >&2
    exit 1 ;;
esac

# What the compositor writes when viz hands back the center of the browser's
# window. BUILT from the format string at domicile-compositor's main.rs:2319
# rather than copied: reword that log site and this test keeps passing while
# the guard stops seeing the line.
drew() { # $1 the pixel, ARGB and uppercase, as `{:08X}` prints it
  printf '%s%s%s\n' \
    '2026-09-22T00:03:29.112233Z  INFO domicile::engine::spike: engine drew #' \
    "$1" " at the center of the browser's window"
}

# The poll, against a log that gains `engine drew` lines on a schedule: each
# argument after the patience is `<seconds>:<pixel>`. Prints what the poll
# read, how long it waited, and whether it wrote a measurement down, so a case
# can assert on any of the three.
#
# The writers' stdout goes nowhere rather than to the command substitution's
# pipe: a case that gives up before its last line lands would otherwise be held
# open until that line's `sleep` returned, and the clock this prints would be
# the harness's.
poll() { # $1 how patient, $2.. when:pixel
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  local patience="$1"; shift
  : >"$dir/comp"
  local when
  for when in "$@"; do
    ( sleep "${when%%:*}"; drew "${when#*:}" >>"$dir/comp" ) >/dev/null 2>&1 &
  done
  (
    LOOKS="$patience"
    NEGATIVE=0
    COLOR="$CLIENT"
    COMP_LOG="$dir/comp"
    # Somewhere of its own, so a case cannot read another case's note and the
    # runner's /tmp is left alone.
    DOMICILE_CONTROL_BUDGET_DIR="$dir/budgets"
    eval "$BLOCK" 2>/dev/null
    printf '%s %s %s\n' "${DRAWN:-nothing}" "$WAITED" \
      "$(if [ -f "$dir/budgets/client-window" ]; then
           echo noted
         else
           echo unnoted
         fi)"
  )
}

# THE RUN THAT USED TO LOSE. The page paints first and the client's color
# arrives two seconds later, which is the ordering every failure had. Nothing
# about this run is broken, so the poll has to reach the second line.
r="$(poll 10 "1:FFFFFFFF" "3:FF$CLIENT")"
expect "the poll waits for the client's own color rather than the page's" \
  "FF$CLIENT" "$(printf '%s\n' "$r" | cut -d' ' -f1)"
# AND IT IS A MEASUREMENT, because this run saw what it was looking for. The
# control reads this number to decide how long an absence has to last, so the
# happy path has to keep writing it down.
expect "and a run that saw it writes its reading down for the control" \
  "noted" "$(printf '%s\n' "$r" | cut -d' ' -f3)"

# THE BOUND THAT MAKES WAITING FOR ONE COLOR SAFE. A poll that only ever ends
# on the client's color is a job GitHub's `timeout-minutes` kills, which
# reports nothing about the seam. It gives up -- and it gives up holding the
# last color it saw, because "the page is showing #FFFFFFFF, which is not the
# client's" is the finding, and "nothing drew at all" is a different one.
r="$(poll 3 "1:FFFFFFFF")"
expect "a client color that never arrives ends the poll on what the page did show" \
  "FFFFFFFF" "$(printf '%s\n' "$r" | cut -d' ' -f1)"
# AND THAT IS NOT A MEASUREMENT. This run measured the guard's own patience,
# not the system's; a note here is a shorter budget for the next control on the
# strength of a timeout, which is the thing `lib-control-budget.sh` exists to
# prevent.
expect "and a run that timed out writes nothing down for the control" \
  "unnoted" "$(printf '%s\n' "$r" | cut -d' ' -f3)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
