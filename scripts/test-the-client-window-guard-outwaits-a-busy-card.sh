#!/usr/bin/env bash
# How long `guard-client-window.sh` watches for a drawn frame before it calls
# the seam broken, asserted.
#
# WHAT THIS IS ABOUT. `crux` runs two jobs at once now, and both of them draw
# on the one render node: `engine.yml` on the `crux` slot and
# `pinned-engine.yml` on `crux-light`. The card is locked only around the steps
# that TIME something -- `guard-latency.sh` and its control -- and the reason
# the rest were left unlocked is written into `engine.yml`:
#
#   Every other guard in this job survives losing it: they ask whether a color
#   landed, and a second client on the card makes that slower rather than
#   wrong.
#
# THAT SENTENCE IS ONLY TRUE WHILE THE GUARD IS PATIENT ENOUGH, and on
# 2026-09-21 it stopped being. The Chromium tree pool (#485) took an engine run
# from ~4h, nearly all of it compiling, to ~11m that is mostly guards -- so the
# two jobs' pixel phases went from rarely overlapping to overlapping almost
# every time both fire on one commit. `Pinned engine` run 183 on `b9e2c33` and
# run 185 on #480 both went red with
#
#   guard-client-window: the engine never drew a client frame
#
# beside a fully overlapping `Engine` run that was itself green. Sixty seconds
# was between seven and twelve times what the guard spends on a quiet machine
# -- ~5s of polling, measured on engine run 35496858205 -- and a busy card ate
# all of it. "Slower rather than wrong" became "red nobody caused", which is
# the failure mode that teaches people to re-run until green.
#
# SO THE PATIENCE IS THE THING WITH A FLOOR UNDER IT, and it is free because
# the poll stops the moment it sees a color: a healthy run costs what it always
# cost however high this goes. That is the first case below, and it is what
# makes the floor affordable rather than a tax.
#
# IT IS STILL BOUNDED, and the second case is why that matters. A poll with no
# end is a job that runs until GitHub's `timeout-minutes` kills it, which
# reports nothing about the seam. The guard has to give up eventually and say
# so -- and it must give up before the client it is watching is reaped, because
# `CLIENT_LIVES_FOR` ends kitty and the probe runs on the submit path: a client
# reaped mid-poll stops the measurement dead and the guard would then report
# that nothing ever drew. That ordering is the third case.
#
# The poll is run out of the real script rather than copied, as
# `test-shell-guard.sh` does, so a rewrite that moves it fails here loudly
# instead of leaving this passing against a version nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The poll writes the guard's reading down for the negative control to read,
# and `budget_note` is what does it. The real one, so a block that stops
# calling it fails here.
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
at_least() { # what, floor, got
  case "$3" in
    (''|*[!0-9]*) printf '  FAIL  %s\n    not a number: %s\n' "$1" "$3"
      FAILED=$((FAILED + 1)); return ;;
  esac
  if [ "$3" -ge "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted at least: %s\n    got:             %s\n' \
      "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# --- the poll itself ---------------------------------------------------------

# From `DRAWN=""` to the `fi` that ends the note it writes down. Both ends are
# whole lines, so this cannot half-match.
BLOCK="$(awk '/^DRAWN=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no draw poll in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# What the client draws, which is what the poll now breaks on: it waits for the
# color the guard asserts rather than for any drawn color at all, so the fixture
# below and the `COLOR` the poll compares against have to be one value. Read out
# of the guard so they stay one.
# scripts/test-the-client-window-guard-waits-for-the-clients-own-color.sh is
# what asserts that choice; the cases here are about how long it will wait.
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
DREW='2026-09-22T00:03:29.112233Z  INFO domicile::engine::spike: engine drew #FF'"$CLIENT"' at the center of the browser'"'"'s window'

# The poll, against a log that gains the line `$2` seconds in. Prints what it
# read and how long it waited, so a case can assert on either.
poll() { # $1 how patient, $2 when the line lands
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  : >"$dir/comp"
  (
    LOOKS="$1"
    NEGATIVE=0
    COLOR="$CLIENT"
    COMP_LOG="$dir/comp"
    # Somewhere of its own, so a case cannot read another case's note and the
    # runner's /tmp is left alone.
    DOMICILE_CONTROL_BUDGET_DIR="$dir/budgets"
    ( sleep "$2"; printf '%s\n' "$DREW" >>"$dir/comp" ) &
    eval "$BLOCK" 2>/dev/null
    printf '%s %s\n' "${DRAWN:-nothing}" "$WAITED"
  )
}

r="$(poll 240 2)"
expect "a color that turns up is read" "FF3366CC" "${r% *}"
# THE FLOOR IS FREE BECAUSE OF THIS. The poll breaks on the first sighting, so
# how patient it is willing to be costs a healthy run nothing at all. Four
# rather than two, because the loop sleeps a second between looks and the line
# lands between two of them.
if [ "${r#* }" -le 4 ]; then
  printf '  ok    %s\n' "and the poll stops there rather than spending its budget"
else
  printf '  FAIL  %s\n    waited: %ss\n' \
    "and the poll stops there rather than spending its budget" "${r#* }"
  FAILED=$((FAILED + 1))
fi

# And the other end of it: a guard that never gives up is a job GitHub kills,
# which says nothing about the seam. The patience is a bound, not a promise.
r="$(poll 2 30)"
expect "a color that never turns up ends the poll" "nothing" "${r% *}"

# --- what the bound is -------------------------------------------------------

# The default, which is the one that runs in CI: neither workflow sets `LOOKS`.
LOOKS_DEFAULT="$(sed -n 's/^LOOKS="${LOOKS:-\([0-9]*\)}"$/\1/p' "$GUARD")"
CLIENT_LIVES_FOR_DEFAULT="$(
  sed -n 's/^CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-\([0-9]*\)}"$/\1/p' "$GUARD"
)"

# THE NUMBER IS A FLOOR RATHER THAN A VALUE, because what is being asserted is
# that the guard outlasts a busy card and not that it waits exactly this long.
# 180 is three times the sixty that went red beside an overlapping engine run,
# and ~36x the ~5s the poll spends on a quiet machine.
at_least "the poll outlasts a card the other runner is drawing on" \
  180 "$LOOKS_DEFAULT"

# AND IT ENDS WHILE THERE IS STILL A CLIENT TO WATCH. `CLIENT_LIVES_FOR` is a
# `timeout` around kitty, and the probe runs on the submit path -- so a client
# reaped mid-poll stops the measurement and the guard reports "the engine never
# drew a client frame" about its own harness. Raising the patience past the
# client's life would buy exactly that.
if [ "$LOOKS_DEFAULT" -lt "$CLIENT_LIVES_FOR_DEFAULT" ]; then
  printf '  ok    %s\n' "and it gives up before the client it is watching is reaped"
else
  printf '  FAIL  %s\n    the poll waits %ss and the client lives %ss\n' \
    "and it gives up before the client it is watching is reaped" \
    "$LOOKS_DEFAULT" "$CLIENT_LIVES_FOR_DEFAULT"
  FAILED=$((FAILED + 1))
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
