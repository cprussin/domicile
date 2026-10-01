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
# No waiting unless a case asks for it.
export DOMICILE_COMPILE_SLOT_WAIT=0 DOMICILE_COMPILE_SLOT_POLL=0.1 DOMICILE_COMPILE_SLOT_RECHECK=0
# A person's build unless a case says otherwise: on a runner every taker would
# be that runner, and the cases below are about two different holders.
unset RUNNER_NAME

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

contains "the refusal says to re-run" "re-run" "$held"
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

# IT WAITS FOR A HOLDER THAT FINISHES, now that a cached compile is minutes:
# refusing turned every overlap of two engine PRs into a red job to re-run.
rm -rf "$WORK/slot"
slot take frank >/dev/null
( sleep 0.5; slot drop frank >/dev/null ) &
expect "a taker waits for a holder that drops" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_WAIT=5 slot take grace)")"
wait
slot drop grace >/dev/null
slot take heidi >/dev/null
waited="$(DOMICILE_COMPILE_SLOT_WAIT=1 slot take ivan)"
expect "and still refuses one that outlasts the wait" refused "$(status "$waited")"
contains "saying how long it waited" "waited 1s" "$waited"
slot drop heidi >/dev/null

# A WAIT THAT CAN OUTLAST A COLD REPIN is hours of one log line, so it says
# when the slot changes hands: a holder that finished and another run that got
# there first reads differently from one holder that never moves.
rm -rf "$WORK/slot"
slot take judy >/dev/null
( sleep 0.5; slot drop judy >/dev/null; slot take mallory >/dev/null
  sleep 0.5; slot drop mallory >/dev/null ) &
waited="$(DOMICILE_COMPILE_SLOT_WAIT=5 slot take niaj)"
wait
expect "a taker outwaits a second holder" ok "$(status "$waited")"
contains "and says it was waiting on the first" "'judy'" "$waited"
contains "and on the second" "'mallory'" "$waited"
slot drop niaj >/dev/null

# A WAITER WHOSE COMMIT HAS BEEN REPLACED STOPS WAITING. The wait can outlast a
# cold repin, and a run for a commit its branch has moved past holds a `crux`
# runner that whole time for a result nobody will read. The workflow says what
# "still wanted" means; this only asks it while waiting.
rm -rf "$WORK/slot"
slot take oscar >/dev/null
: >"$WORK/output"
gone="$(GITHUB_OUTPUT="$WORK/output" DOMICILE_COMPILE_SLOT_WAIT=30 \
  DOMICILE_COMPILE_SLOT_STILL_WANTED='echo "replaced by abc"; exit 1' slot take peggy)"
expect "a waiter that is no longer wanted gives up" refused "$(status "$gone")"
contains "saying why" "replaced by abc" "$gone"
case "$gone" in (*"waited 30s"*) r=outwaited ;; (*) r=early ;; esac
expect "before its wait runs out" early "$r"
expect "and tells the workflow it was superseded" "superseded=true" "$(cat "$WORK/output")"
contains "without touching the holder's slot" "'oscar'" "$(slot who)"

# A check that cannot answer is not a verdict: a flaky network must not end a
# wanted run's wait. It keeps waiting and asks again.
kept="$(DOMICILE_COMPILE_SLOT_WAIT=1 \
  DOMICILE_COMPILE_SLOT_STILL_WANTED='echo "no route to origin"; exit 3' slot take quentin)"
contains "a check that errors does not end the wait" "waited 1s" "$kept"
contains "but says it could not ask" "no route to origin" "$kept"

# AND ONCE BEFORE TAKING A FREE SLOT. engine.yml queues a compiling run on
# GitHub rather than here, so the long wait can end with the slot free and the
# commit replaced; the question is asked where that wait ends.
free="$WORK/free-slot"
: >"$WORK/output"
gone="$(DOMICILE_COMPILE_SLOT="$free" GITHUB_OUTPUT="$WORK/output" \
  DOMICILE_COMPILE_SLOT_STILL_WANTED='echo "replaced by def"; exit 1' slot take trent)"
expect "a run no longer wanted does not take a free slot" refused "$(status "$gone")"
expect "and tells the workflow it was superseded" "superseded=true" "$(cat "$WORK/output")"
expect "and leaves the slot free" free "$([ -d "$free" ] && echo held || echo free)"
expect "a check that cannot answer still takes a free slot" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT="$free" \
    DOMICILE_COMPILE_SLOT_STILL_WANTED='exit 3' slot take ursula)")"
rm -rf "$free"

( sleep 0.5; slot drop oscar >/dev/null ) &
expect "a waiter that is still wanted takes the slot when it frees" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_WAIT=5 DOMICILE_COMPILE_SLOT_STILL_WANTED=true slot take rupert)")"
wait
slot drop rupert >/dev/null

# A HOLDER CAN SEE SOMEBODY WAITING, AND STEP ASIDE FOR THEM. The production
# build holds the slot for hours; a pull request's minute-long compile should
# not queue behind it. So a waiter says it is waiting, and a holder that is
# willing to be interrupted asks.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
slot take victor >/dev/null
expect "nobody waiting is not wanted" refused "$(status "$(slot wanted victor)")"
( DOMICILE_COMPILE_SLOT_WAIT=2 slot take walter >/dev/null ) &
sleep 0.5
wanted="$(slot wanted victor)"
expect "a waiter makes the slot wanted" ok "$(status "$wanted")"
contains "and is named" "'walter'" "$wanted"
wait
expect "a waiter that gave up no longer wants it" refused \
  "$(status "$(slot wanted victor)")"

# A WAITER THAT DIED leaves its note behind, and a holder that yields to a
# ghost yields for ever. Only a note refreshed recently counts.
mkdir -p "$WORK/slot.waiting"
echo "a run that was killed" >"$WORK/slot.waiting/ghost"
touch -d '10 minutes ago' "$WORK/slot.waiting/ghost"
expect "a waiter that stopped refreshing is not wanted" refused \
  "$(status "$(slot wanted victor)")"

# A NOTE IS NEVER READ HALF-WRITTEN. A waiter rewrites it every poll, and a
# holder that read a name with no rank under it would yield to a waiter it
# outranks; one that read nothing would miss it. So read it while it is
# rewritten as fast as it can be, then free the slot to end the wait.
( DOMICILE_COMPILE_SLOT_RANK=1 DOMICILE_COMPILE_SLOT_WAIT=5 DOMICILE_COMPILE_SLOT_POLL=0 \
    slot take tom >/dev/null ) &
tom="$WORK/slot.waiting/$(printf tom | sha256sum | cut -d' ' -f1)"
tries=0
until [ -s "$tom" ] || [ "$tries" -ge 50 ]; do sleep 0.1; tries=$((tries + 1)); done
torn=0
for _ in $(seq 20000); do
  { IFS= read -r name; IFS= read -r rank; } <"$tom" 2>/dev/null
  [ "${name:-}:${rank:-}" = "tom:1" ] || torn=$((torn + 1))
done
expect "a waiter's note is never read half-written" 0 "$torn"
slot drop victor >/dev/null
wait
slot drop tom >/dev/null
slot take victor >/dev/null
# Nor is the one being written beside it until it is renamed over it.
printf 'tom\n' >"$tom.tmp"
expect "a note still being written is not a waiter" refused \
  "$(status "$(slot wanted victor)")"
rm -f "$tom.tmp"

# Yielding hands the slot to the waiter rather than racing it for the slot.
( DOMICILE_COMPILE_SLOT_WAIT=5 slot take wendy >/dev/null; sleep 1 ) &
sleep 0.5
expect "the holder yields" ok "$(status "$(slot yield victor)")"
contains "and the waiter has it when the yield returns" "'wendy'" "$(slot who)"
wait
slot drop wendy >/dev/null
slot take victor >/dev/null
expect "a yield with nobody waiting just drops" ok \
  "$(status "$(slot yield victor)")"
contains "and leaves it free" "nobody is compiling" "$(slot who)"
expect "only the holder can yield" refused "$(status "$(slot yield xavier)")"

# A HOLDER WITH A RANK YIELDS ONLY TO A HIGHER ONE. engine.yml's cold build
# steps aside for a warm compile, and engine-release.yml's steps aside for
# both. Two holders that each yielded to the other would hand the slot back
# and forth, killing both builds every poll. Unranked is the highest: a waiter
# that says nothing is a compile that never steps aside.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
slot take victor >/dev/null
( DOMICILE_COMPILE_SLOT_RANK=1 DOMICILE_COMPILE_SLOT_WAIT=2 slot take walter >/dev/null ) &
sleep 0.5
expect "a rank-1 holder does not yield to a rank-1 waiter" refused \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=1 slot wanted victor)")"
expect "a rank-0 holder yields to it" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=0 slot wanted victor)")"
expect "and an unranked holder yields to everybody" ok \
  "$(status "$(slot wanted victor)")"
wait
( DOMICILE_COMPILE_SLOT_WAIT=2 slot take wendy >/dev/null ) &
sleep 0.5
expect "a rank-1 holder yields to an unranked waiter" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=1 slot wanted victor)")"
wait
slot drop victor >/dev/null

# A HOLD LEFT BY A RUNNER'S LAST JOB IS DEAD. A runner runs one job at a time
# and kills what that job left running before the next, so a runner taking the
# slot from a holder on that same runner is taking it from a job that is over:
# on 2026-09-28 a runner restart skipped the `always()` drop and every compile
# waited ten hours behind it. Any other holder is still refused.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
RUNNER_NAME=crux-two slot take yvonne >/dev/null
expect "a holder on another runner is refused" refused \
  "$(status "$(RUNNER_NAME=crux slot take zelda)")"
expect "a person's build is refused" refused "$(status "$(slot take abe)")"
cleared="$(RUNNER_NAME=crux-two slot take bea)"
expect "a holder on this runner is cleared" ok "$(status "$cleared")"
contains "naming whose hold it cleared" "'yvonne' left on this runner" "$cleared"
slot drop bea >/dev/null
slot take cyd >/dev/null
expect "a runner never clears a person's build" refused \
  "$(status "$(RUNNER_NAME=crux-two slot take dot)")"
slot drop cyd >/dev/null

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
