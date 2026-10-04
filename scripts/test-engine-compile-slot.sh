#!/usr/bin/env bash
# Tests `engine-compile-slot.sh`, which keeps two Chromium compiles from
# running at once on `crux` (62G, no swap).
#
# The tree pool allows two runs two trees, but two cold builds run out of
# memory. The slot must queue a second taker, and the unconditional `drop` at
# the end of a job must not release another run's slot.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLOT_SH="$ROOT/.github/scripts/engine-compile-slot.sh"
[ -x "$SLOT_SH" ] || { echo "no $SLOT_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export DOMICILE_COMPILE_SLOT="$WORK/slot"
# No waiting unless a case asks for it.
export DOMICILE_COMPILE_SLOT_WAIT=0 DOMICILE_COMPILE_SLOT_POLL=0.1 DOMICILE_COMPILE_SLOT_RECHECK=0
# Cases act as a person's build unless they set RUNNER_NAME, since every taker
# on one runner would share a name.
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
# A background waiter may start slowly on a busy runner, so poll until it is
# waiting, bounded by the waiter's own timeout.
until_wanted() { # holder; says what the last `wanted` said
  local out tries=0
  until out="$(slot wanted "$1")"; [ "$(status "$out")" = ok ] || [ "$tries" -ge 20 ]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  printf '%s\n' "$out"
}

expect "a free slot is taken" ok "$(status "$(slot take alice)")"
expect "a second taker is refused" refused "$(status "$(slot take bob)")"

held="$(slot take bob)"
contains "the refusal names who holds it" "'alice'" "$held"
contains "the refusal reports an age" "held for 0m" "$held"

contains "the refusal says to re-run" "re-run" "$held"
contains "the refusal prints the command that clears a stale slot" \
  "rm -rf $WORK/slot" "$held"

# The drop step runs under `if: always()`, including when taking the slot
# failed. A plain `rm` there would let a third run compile beside the holder.
slot drop bob >/dev/null
expect "a run that does not hold it cannot drop it" ok "$(status "$(slot who)")"
contains "and it is still alice's" "'alice'" "$(slot who)"

expect "the holder can drop it" ok "$(status "$(slot drop alice)")"
contains "and then nothing holds it" "nobody is compiling" "$(slot who)"
expect "the slot can be taken again" ok "$(status "$(slot take carol)")"

# The `always()` step also runs when the slot was never taken: an early failure
# or any warm run.
slot drop carol >/dev/null
expect "dropping a free slot is a no-op, not an error" ok \
  "$(status "$(slot drop carol)")"

# Age is shown in hours and minutes so a person can tell a build (4h) from a
# dead run (14h).
slot take dave >/dev/null
echo "$(( $(date +%s) - 40200 ))" >"$WORK/slot/since"
contains "an old slot reads in hours and minutes" "held for 11h 10m" "$(slot who)"

# A wrong age invites clearing a slot whose holder is still linking, so an
# unreadable timestamp reports "unknown age".
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

# A taker waits for the holder to finish, since a cached compile takes minutes.
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

# A wait can last hours, so it logs each change of holder.
rm -rf "$WORK/slot"
slot take judy >/dev/null
# Hand the slot directly to mallory: a drop then take leaves a gap that niaj
# could fill.
( sleep 0.5; echo mallory >"$WORK/slot/owner.new"
  mv "$WORK/slot/owner.new" "$WORK/slot/owner"
  sleep 0.5; slot drop mallory >/dev/null ) &
waited="$(DOMICILE_COMPILE_SLOT_WAIT=5 slot take niaj)"
wait
expect "a taker outwaits a second holder" ok "$(status "$waited")"
contains "and says it was waiting on the first" "'judy'" "$waited"
contains "and on the second" "'mallory'" "$waited"
slot drop niaj >/dev/null

# A waiter whose commit was replaced stops waiting, so it does not hold a
# `crux` runner for nothing. The workflow defines "still wanted"; this only
# asks.
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

# A check that cannot answer (exit 3) does not end the wait.
kept="$(DOMICILE_COMPILE_SLOT_WAIT=1 \
  DOMICILE_COMPILE_SLOT_STILL_WANTED='echo "no route to origin"; exit 3' slot take quentin)"
contains "a check that errors does not end the wait" "waited 1s" "$kept"
contains "but says it could not ask" "no route to origin" "$kept"

# engine.yml queues compiling runs on GitHub, so the commit may be replaced by
# the time the slot is free. The check also runs before taking a free slot.
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

# A runner shut down mid-build never runs its drop. A waiter clears the slot
# when the workflow's check (given HOLDER) says the holder's run is over.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
slot take 'engine.yml run 111 attempt 1' >/dev/null
took="$(DOMICILE_COMPILE_SLOT_WAIT=30 \
  DOMICILE_COMPILE_SLOT_HOLDER_DONE='[ "$HOLDER" = "engine.yml run 111 attempt 1" ] && echo "run 111 is completed"' \
  slot take 'engine.yml run 222 attempt 1')"
expect "a waiter takes the slot from a holder whose run is over" ok "$(status "$took")"
contains "saying whose and why" "run 111 is completed" "$took"
slot drop 'engine.yml run 222 attempt 1' >/dev/null

# Only on a yes: a running holder may be linking. Any other answer leaves the
# holder alone.
slot take 'engine.yml run 333 attempt 1' >/dev/null
for verdict in 'exit 1' 'echo "no route"; exit 3'; do
  out="$(DOMICILE_COMPILE_SLOT_WAIT=1 DOMICILE_COMPILE_SLOT_HOLDER_DONE="$verdict" \
    slot take 'engine.yml run 444 attempt 1')"
  expect "a holder not known to be over keeps the slot ($verdict)" refused "$(status "$out")"
done
contains "and still holds it" "run 333" "$(slot who)"
slot drop 'engine.yml run 333 attempt 1' >/dev/null

# A waiter announces itself, and a holder willing to be interrupted can yield.
# A pull request's short compile then need not wait behind a production build.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
slot take victor >/dev/null
expect "nobody waiting is not wanted" refused "$(status "$(slot wanted victor)")"
( DOMICILE_COMPILE_SLOT_WAIT=2 slot take walter >/dev/null ) &
wanted="$(until_wanted victor)"
expect "a waiter makes the slot wanted" ok "$(status "$wanted")"
contains "and is named" "'walter'" "$wanted"
wait
expect "a waiter that gave up no longer wants it" refused \
  "$(status "$(slot wanted victor)")"

# A dead waiter leaves its note behind. Only a recently refreshed note counts.
mkdir -p "$WORK/slot.waiting"
echo "a run that was killed" >"$WORK/slot.waiting/ghost"
touch -d '10 minutes ago' "$WORK/slot.waiting/ghost"
expect "a waiter that stopped refreshing is not wanted" refused \
  "$(status "$(slot wanted victor)")"

# A waiter rewrites its note every poll. A partial read would make a holder
# yield to a waiter it outranks, or miss it. Read it repeatedly while it is
# rewritten as fast as possible, then free the slot to end the wait.
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
# A note is not read until it is renamed into place.
printf 'tom\n' >"$tom.tmp"
expect "a note still being written is not a waiter" refused \
  "$(status "$(slot wanted victor)")"
rm -f "$tom.tmp"

# Yielding hands the slot to the waiter instead of racing it.
( DOMICILE_COMPILE_SLOT_WAIT=5 slot take wendy >/dev/null; sleep 1 ) &
until_wanted victor >/dev/null
expect "the holder yields" ok "$(status "$(slot yield victor)")"
contains "and the waiter has it when the yield returns" "'wendy'" "$(slot who)"
wait
slot drop wendy >/dev/null
slot take victor >/dev/null
expect "a yield with nobody waiting just drops" ok \
  "$(status "$(slot yield victor)")"
contains "and leaves it free" "nobody is compiling" "$(slot who)"
expect "only the holder can yield" refused "$(status "$(slot yield xavier)")"

# A ranked holder yields only to a higher rank, or two holders would hand the
# slot back and forth. engine.yml's cold build yields to a warm compile, and
# engine-release.yml yields to both. Unranked is highest.
rm -rf "$WORK/slot" "$WORK/slot.waiting"
slot take victor >/dev/null
# Long enough for all three checks below on a busy runner.
( DOMICILE_COMPILE_SLOT_RANK=1 DOMICILE_COMPILE_SLOT_WAIT=5 slot take walter >/dev/null ) &
until_wanted victor >/dev/null
expect "a rank-1 holder does not yield to a rank-1 waiter" refused \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=1 slot wanted victor)")"
expect "a rank-0 holder yields to it" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=0 slot wanted victor)")"
expect "and an unranked holder yields to everybody" ok \
  "$(status "$(slot wanted victor)")"
wait
( DOMICILE_COMPILE_SLOT_WAIT=2 slot take wendy >/dev/null ) &
until_wanted victor >/dev/null
expect "a rank-1 holder yields to an unranked waiter" ok \
  "$(status "$(DOMICILE_COMPILE_SLOT_RANK=1 slot wanted victor)")"
wait
slot drop victor >/dev/null

# A runner runs one job at a time and kills leftovers, so a hold left on the
# same runner belongs to a finished job (a runner restart can skip the
# `always()` drop). Any other holder is still refused.
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

# A tree can carry the series with a cold out/Release, and a cold build without
# the slot runs out of memory. Only a build of these exact inputs is warm.
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
# Re-applying the series makes a new commit, and its build may have died.
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
