#!/usr/bin/env bash
# The compile slot's one job: two Chromium compiles never run at once.
#
# The pool lets two runs hold two trees, which is the point of it. What it does
# not give them is a second machine: `crux` has 62G and no swap, and two cold
# Chromium builds in it is an OOM on the machine that serves the house its DNS.
#
# So the parts worth a test are the ones that make it a queue rather than a
# crash: whether a second taker is refused, and whether the unconditional
# `drop` at the end of a job can release somebody else's.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLOT_SH="$ROOT/.github/scripts/engine-compile-slot.sh"
[ -x "$SLOT_SH" ] || { echo "no $SLOT_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export DOMICILE_COMPILE_SLOT="$WORK/slot"

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
slot() { # subcommand, owner
  local out
  if out="$("$SLOT_SH" "$1" "${2:-}" 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }

expect "a free slot is taken" ok "$(status "$(slot take alice)")"
expect "a second taker is refused" refused "$(status "$(slot take bob)")"

held="$(slot take bob)"
contains "the refusal names who holds it" "'alice'" "$held"
contains "the refusal reports an age" "held for 0m" "$held"

# IT REFUSES RATHER THAN WAITS, and the message has to say why: a run that
# waited here would sit on the second runner for the four hours the holder
# needs, which is the queue the tree pool was built to remove.
contains "the refusal says to re-run rather than to wait" "re-run" "$held"
contains "the refusal prints the command that clears a stale slot" \
  "rm -rf $WORK/slot" "$held"

# THE CASE THAT MAKES `drop` A CHECK RATHER THAN AN `rm`. The drop step is
# `if: always()`, so it also runs on the path where TAKING the slot is what
# failed -- and an unconditional remove there lets a third run start compiling
# beside the holder, which is the OOM this exists to prevent.
slot drop bob >/dev/null
expect "a run that does not hold it cannot drop it" ok "$(status "$(slot who)")"
contains "and it is still alice's" "'alice'" "$(slot who)"

expect "the holder can drop it" ok "$(status "$(slot drop alice)")"
contains "and then nothing holds it" "nobody is compiling" "$(slot who)"
expect "the slot can be taken again" ok "$(status "$(slot take carol)")"

# Dropping nothing is not a failure: the `always()` step also runs on the path
# where the job failed before the slot was ever taken, and on every warm run,
# which never takes it at all.
slot drop carol >/dev/null
expect "dropping a free slot is a no-op, not an error" ok \
  "$(status "$(slot drop carol)")"

# AGE, IN THE UNITS THAT DECIDE. Four hours is a build; fourteen is a run that
# died and left this behind.
slot take dave >/dev/null
echo "$(( $(date +%s) - 40200 ))" >"$WORK/slot/since"
contains "an old slot reads in hours and minutes" "held for 11h 10m" "$(slot who)"

# NOTHING STEALS IT ON A GUESS. A confident wrong age invites clearing a slot
# whose holder is still linking, so an unreadable timestamp says so instead.
echo "not a number" >"$WORK/slot/since"
contains "a corrupt timestamp is unknown, not nonsense" "unknown age" "$(slot who)"
rm -f "$WORK/slot/since"
contains "a missing timestamp is unknown" "unknown age" "$(slot who)"
echo "$(( $(date +%s) + 9000 ))" >"$WORK/slot/since"
contains "a clock that moved backward is unknown, not negative" \
  "unknown age" "$(slot who)"

rm -f "$WORK/slot/owner"
contains "a slot with no name in it still refuses a taker" \
  "did not write their name" "$(slot take erin)"
slot drop "" >/dev/null 2>&1
contains "and an empty owner cannot claim it" "is being compiled here by" "$(slot who)"

# WHETHER A RUN WILL COMPILE. A tree can carry the series while its
# out/Release is cold -- built under other args, or never -- and a cold build
# without the slot is the OOM. Only a build of exactly these inputs is warm.
export DOMICILE_BUILT_STAMP="$WORK/built"
export DOMICILE_SERIES_STAMP="$WORK/series-stamp"
echo "series A over commit 1" >"$DOMICILE_SERIES_STAMP"
mkdir -p "$WORK/tree/src/out/Release"
: >"$WORK/tree/src/out/Release/args.gn"
warm() {
  : >"$WORK/output"
  GITHUB_OUTPUT="$WORK/output" "$SLOT_SH" warm "$WORK/tree/src" >/dev/null 2>&1
  sed -n 's/^warm=//p' "$WORK/output"
}
expect "a tree never built here is cold" false "$(warm)"
"$SLOT_SH" built "$WORK/tree/src" >/dev/null 2>&1
expect "a tree just built from these inputs is warm" true "$(warm)"
# The same series re-applied is a new commit, and its build may have died.
echo "series A over commit 2" >"$DOMICILE_SERIES_STAMP"
expect "a tree re-applied since its last build is cold" false "$(warm)"
"$SLOT_SH" built "$WORK/tree/src" >/dev/null 2>&1
rm -rf "$WORK/tree/src/out/Release"
expect "a tree whose out/Release is gone is cold" false "$(warm)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
