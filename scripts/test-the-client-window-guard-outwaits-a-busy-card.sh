#!/usr/bin/env bash
# Tests the draw poll in `guard-client-window.sh`: which frame it waits for and
# how long it waits.
#
# - It waits for the client's color. The page's own draws (white, then indigo)
#   land first and must not end the poll.
# - It is patient enough to outlast a busy render node. `engine.yml` and
#   `pinned-engine.yml` run on `crux` at once and share the card; only the
#   timing guards lock it.
# - It is bounded, so a broken seam fails with a message instead of a job
#   timeout.
# - It gives up before `CLIENT_LIVES_FOR` reaps the client. A reaped client
#   stops the probe and the guard would report that nothing drew.
#
# The poll is cut out of the real script, as `test-shell-guard.sh` does, so a
# rewrite that moves it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The poll records its reading for the negative control through the real
# `budget_note`.
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

# From `DRAWN=""` to the `fi` that ends the note. Both ends are whole lines.
BLOCK="$(awk '/^DRAWN=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no draw poll in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The line the compositor logs for the color at the center of the browser's
# window. Built from the format string at domicile-compositor's main.rs:2295,
# so rewording that log site must be mirrored here.
drew_line() { # $1 what viz handed back, in ARGB
  printf "2026-09-22T00:03:29.112233Z  INFO domicile::engine::spike: engine drew #%s at the center of the browser's window\n" "$1"
}

# The client's color, which the guard waits for.
DREW="$(drew_line FF3366CC)"
# The page's own indigo and the blank window. Both land before the client's
# buffer reaches the page.
PAGE="$(drew_line FF3F51B5)"
BLANK="$(drew_line FFFFFFFF)"

# Runs the poll against a log that holds `$3...` and gains the client's line
# after the guard has looked `$2` times. Prints the color read, the looks
# waited, and the note written for the control (`none` if no note).
#
# The fixture counts looks, not seconds. It defines a `sleep` function that the
# guard's loop calls between looks, and appends the client's line on the
# `$2`th call. `WAITED` then equals `$2` at any machine load, and no case waits
# on a real clock. The guard's block itself is not stubbed.
poll() { # $1 how patient, $2 how many looks before the client's line lands, $3... what the log holds
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  : >"$dir/comp"
  local held
  for held in "${@:3}"; do printf '%s\n' "$held" >>"$dir/comp"; done
  (
    LOOKS="$1"
    NEGATIVE=0
    # The color the guard drives its client with.
    COLOR=3366CC
    COMP_LOG="$dir/comp"
    # A directory per case, so cases do not read each other's notes.
    DOMICILE_CONTROL_BUDGET_DIR="$dir/budgets"
    LANDS_AFTER="$2"
    LOOKED=0
    # Counts the guard's looks. A `$2` past the guard's patience means the line
    # never lands. A block that stops calling `sleep` also never lands it, so
    # it fails here.
    sleep() {
      LOOKED=$((LOOKED + 1))
      if [ "$LOOKED" -ge "$LANDS_AFTER" ]; then
        printf '%s\n' "$DREW" >>"$COMP_LOG"
      fi
    }
    eval "$BLOCK" 2>/dev/null
    # `none` is a reading: two cases assert that no note was written.
    local noted="none"
    if [ -f "$dir/budgets/client-window" ]; then
      noted="$(sed -n '1p' "$dir/budgets/client-window")"
    fi
    printf '%s %s %s\n' "${DRAWN:-nothing}" "$WAITED" "$noted"
  )
}

read -r saw waited noted <<<"$(poll 240 2)"
expect "the client's color turning up is read" "FF3366CC" "$saw"
# The poll stops on the first sighting, so a high bound costs a healthy run
# nothing. This checks a ceiling; the next case pins the exact count.
if [ "$waited" -le 4 ]; then
  printf '  ok    %s\n' "and the poll stops there rather than spending its budget"
else
  printf '  FAIL  %s\n    waited: %ss\n' \
    "and the poll stops there rather than spending its budget" "$waited"
  FAILED=$((FAILED + 1))
fi
# The negative control sizes its wait from this note. See
# lib-control-budget.sh.
expect "and hands the control what it measured" "$waited" "$noted"

# A poll without an end would run until GitHub's `timeout-minutes` kills the
# job, which reports nothing about the seam.
read -r saw waited noted <<<"$(poll 2 30)"
expect "a color that never turns up ends the poll" "nothing" "$saw"

# --- whose color it is waiting for -------------------------------------------

# The page's own draws land before the client's buffer reaches it:
#
#   02:08:13.925  engine drew #FFFFFFFF
#   02:08:14.205  engine drew #FF3F51B5      <- the page's own indigo
#
# The poll must keep waiting past them for the client's color.
read -r saw waited noted <<<"$(poll 240 3 "$BLANK" "$PAGE")"
expect "a draw that is not the client's does not end the poll" "FF3366CC" "$saw"
at_least "and the guard spends its patience waiting for one that is" 3 "$waited"

# When the client's color never comes, the guard must report the color it did
# see. That separates "the canvas showed the wrong thing" from "nothing drew",
# which have different causes.
read -r saw waited noted <<<"$(poll 3 30 "$BLANK" "$PAGE")"
expect "and a run that only ever saw the page's own color reports it" \
  "FF3F51B5" "$saw"
# A run that timed out measured its own patience, not the system. A note from
# it could make the control stop watching too early, so only a run that saw
# the client writes one.
expect "and writes down nothing, having measured only its own patience" \
  "none" "$noted"

# --- what the bound is -------------------------------------------------------

# The default, which CI uses: neither workflow sets `LOOKS`.
LOOKS_DEFAULT="$(sed -n 's/^LOOKS="${LOOKS:-\([0-9]*\)}"$/\1/p' "$GUARD")"
CLIENT_LIVES_FOR_DEFAULT="$(
  sed -n 's/^CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-\([0-9]*\)}"$/\1/p' "$GUARD"
)"

# A floor, not an exact value: the guard must outlast a busy card. 180 is three
# times a bound that failed under an overlapping engine run, and ~36x the ~5s
# the poll takes on a quiet machine.
at_least "the poll outlasts a card the other runner is drawing on" \
  180 "$LOOKS_DEFAULT"

# `CLIENT_LIVES_FOR` is a `timeout` around kitty, and the probe runs on the
# submit path. A client reaped mid-poll makes the guard report that the engine
# never drew a client frame.
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
