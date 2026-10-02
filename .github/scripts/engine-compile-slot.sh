#!/usr/bin/env bash
# One Chromium compile at a time on this machine.
#
#   .github/scripts/engine-compile-slot.sh take <owner>
#   .github/scripts/engine-compile-slot.sh drop <owner>
#   .github/scripts/engine-compile-slot.sh wanted <owner>
#   .github/scripts/engine-compile-slot.sh yield <owner>
#   .github/scripts/engine-compile-slot.sh warm <chromium/src>
#   .github/scripts/engine-compile-slot.sh built <chromium/src>
#
# `warm` writes `warm=true` to $GITHUB_OUTPUT only if `built` last recorded
# this applied series built by these build scripts: a tree can carry the series
# with its out/Release cold.
#
# The tree pool gives two runs two trees so that a repin stops blocking every
# other engine branch. It does not give them a second machine: `crux` has 62G
# and `swapDevices = []` (cprussin/dotfiles: config/machines/crux), and a cold
# Chromium build's link step is most of that. Two at once is an OOM kill on the
# machine that serves the house its DNS.
#
# So this is the memory the pool cannot split, and only a run that is going to
# compile takes it -- a run whose tree already carries the series compiles
# nothing and must not queue behind one that does. That pair is the whole
# design: warm runs keep shipping while a repin builds.
#
# IT WAITS, UP TO DOMICILE_COMPILE_SLOT_WAIT SECONDS, then refuses. Refusing
# outright turned every overlap of two engine PRs into a red job to re-run.
# The default is 30 minutes, enough for a cached series change; engine.yml
# waits out a cold repin, because its budget holds that wait and its own
# repin both (scripts/test-the-engine-budget-holds-both-builds.sh).
#
# AND NOTHING STEALS IT ON AGE. A cold build is up to five hours, and clearing
# this while its holder is linking is the OOM it exists to prevent.
#
# ONLY ON WHERE IT WAS TAKEN. A runner runs one job at a time and kills what
# that job left running before it starts the next, so a runner that finds the
# slot held by an earlier job on itself is looking at a job that is over. That
# is how a runner restart leaves it: the `always()` drop never runs. A person's
# build records no runner, and is never cleared.
#
# A HOLDER CAN STEP ASIDE INSTEAD. A waiter leaves a note beside the slot and
# refreshes it every poll; `wanted` says whether a fresh one names anybody else,
# and `yield` drops the slot and returns once a waiter has it. That is for the
# production build, which is hours long and can stop and resume, so that a pull
# request's minute of compiling never queues behind it. Only a note refreshed
# in the last DOMICILE_COMPILE_SLOT_FRESH seconds counts: a waiter that was
# killed cannot write that it stopped waiting, and a holder that yields to it
# would yield for ever.
#
# BY RANK, SO TWO HOLDERS THAT STEP ASIDE CANNOT HAND IT BACK AND FORTH.
# DOMICILE_COMPILE_SLOT_RANK, a number, goes on a waiter's note, and `wanted`
# and `yield` count only notes that outrank it. Unset is the highest: a compile
# that never steps aside. engine-release.yml builds at 0 and engine.yml's cold
# builds at 1, so the production build steps aside for both and a cold pull
# request only for a warm one.
set -u

usage() {
  echo "usage: $(basename "$0") <take|drop|who|wanted|yield> [owner]" >&2
  echo "       $(basename "$0") <warm|built> <chromium/src>" >&2
  exit 2
}

action="${1:-}"
owner="${2:-}"
[ -n "$action" ] || usage

# Under /build, because `PrivateTmp` gives each runner unit its own /tmp and a
# lock between two runners cannot be in one of them. Override for tests.
LOCK="${DOMICILE_COMPILE_SLOT:-/build/.domicile-compile-slot}"
# Beside the slot rather than in it, because the slot is removed on every drop
# and a waiter's note has to outlive the holder it is waiting on.
WAITING="$LOCK.waiting"

HERE="$(cd "$(dirname "$0")" && pwd)"
built_stamp() { echo "${DOMICILE_BUILT_STAMP:-$(dirname "$owner")/.domicile-built}"; }
# The series stamp, not just the series: it names the commit the apply made,
# so a re-apply whose build died is not warm.
build_identity() {
  { cat "${DOMICILE_SERIES_STAMP:-$(dirname "$owner")/.domicile-series-stamp}" 2>/dev/null
    sha256sum "$HERE/engine-build.sh" "$HERE/engine-release-build.sh" | cut -d' ' -f1
  } | sha256sum | cut -d' ' -f1
}

age() {
  local since now secs
  since="$(cat "$LOCK/since" 2>/dev/null || true)"
  case "$since" in
    (*[!0-9]*|'') echo "unknown age (no readable timestamp in it)"; return ;;
  esac
  now="$(date +%s)"
  secs=$((now - since))
  [ "$secs" -ge 0 ] || { echo "unknown age (its timestamp is in the future)"; return; }
  if [ "$secs" -lt 3600 ]; then
    echo "held for $((secs / 60))m"
  else
    echo "held for $((secs / 3600))h $(((secs % 3600) / 60))m"
  fi
}

holder() {
  cat "$LOCK/owner" 2>/dev/null || echo "someone who did not write their name in it"
}

# The note a waiter leaves, named by a hash because an owner is a sentence.
note() { echo "$WAITING/$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)"; }

# Every fresh note that is not <owner>'s and outranks this holder, one owner
# per line. A note's second line is its waiter's rank; no rank outranks every
# rank, and a holder with none counts every note.
waiters() {
  [ -d "$WAITING" ] || return 0
  find "$WAITING" -type f ! -name '*.tmp' -newermt "-${DOMICILE_COMPILE_SLOT_FRESH:-60} seconds" |
    while IFS= read -r waiter; do
      [ "$waiter" != "$(note "$1")" ] || continue
      rank="$(sed -n 2p "$waiter")"
      [ -z "${DOMICILE_COMPILE_SLOT_RANK:-}" ] || [ -z "$rank" ] ||
        [ "$rank" -gt "$DOMICILE_COMPILE_SLOT_RANK" ] || continue
      sed -n 1p "$waiter"
    done
}

case "$action" in
  take)
    [ -n "$owner" ] || usage
    wait_for="${DOMICILE_COMPILE_SLOT_WAIT:-1800}"
    started="$(date +%s)"
    took=""
    asked=0
    holder_asked=0
    mkdir -p "$WAITING"
    waiting="$(note "$owner")"
    trap 'rm -f "$waiting" "$waiting.tmp"' EXIT
    while :; do
      # Whether this run is still worth waiting for, when the workflow says
      # how to tell: exit 0 yes, 1 no, anything else could not ask. A wait
      # can outlast a cold repin, and a run for a commit its branch has moved
      # past holds a runner that whole time for nothing. A check that cannot
      # answer is not a no, so a flaky network never ends a wanted run's wait.
      # Asked before the first take too: engine.yml queues a compiling run on
      # GitHub, so its long wait can end with this slot free.
      if [ -n "${DOMICILE_COMPILE_SLOT_STILL_WANTED:-}" ] &&
         [ $(($(date +%s) - asked)) -ge "${DOMICILE_COMPILE_SLOT_RECHECK:-60}" ]; then
        asked="$(date +%s)"
        why="$(sh -c "$DOMICILE_COMPILE_SLOT_STILL_WANTED" 2>&1)"
        case $? in
          0) ;;
          1)
            echo "::error::no longer waiting for the compile slot: $why" >&2
            [ -z "${GITHUB_OUTPUT:-}" ] || echo "superseded=true" >>"$GITHUB_OUTPUT"
            exit 1
            ;;
          *) echo "could not ask whether this run is still wanted, so it carries on: $why" ;;
        esac
      fi
      mkdir "$LOCK" 2>/dev/null && { took=1; break; }
      if [ -n "${RUNNER_NAME:-}" ] &&
         [ "$(cat "$LOCK/runner" 2>/dev/null)" = "$RUNNER_NAME" ]; then
        echo "cleared the compile slot '$(holder)' left on this runner ($RUNNER_NAME), which runs one job at a time"
        rm -rf "$LOCK"
        continue
      fi
      # AND ON A HOLDER WHOSE RUN IS OVER, wherever it ran: a runner shut down
      # mid-build never drops, and only it could clear what it left, so a
      # build on the other runner waited out the whole slot wait for nothing
      # (run 36923792412, crux-two, 2026-10-01). The workflow says how to ask;
      # only a yes clears, so a run in progress -- maybe linking -- keeps it.
      if [ -n "${DOMICILE_COMPILE_SLOT_HOLDER_DONE:-}" ] &&
         [ $(($(date +%s) - holder_asked)) -ge "${DOMICILE_COMPILE_SLOT_RECHECK:-60}" ]; then
        holder_asked="$(date +%s)"
        gone_holder="$(holder)"
        if why="$(HOLDER="$gone_holder" sh -c "$DOMICILE_COMPILE_SLOT_HOLDER_DONE" 2>&1)"; then
          echo "::warning::cleared the compile slot '$gone_holder' held, because its run is over: $why"
          rm -rf "$LOCK"
          continue
        fi
      fi
      [ $(($(date +%s) - started)) -lt "$wait_for" ] || break
      # Renamed over the last one rather than rewritten in place: a holder
      # reading it between the truncate and the writes would see no waiter,
      # or one with no rank, which outranks everybody.
      printf '%s\n' "$owner" ${DOMICILE_COMPILE_SLOT_RANK:+"$DOMICILE_COMPILE_SLOT_RANK"} >"$waiting.tmp"
      mv "$waiting.tmp" "$waiting"
      # Once per holder, not once: a wait can outlast a cold repin, and hours
      # of one line cannot say whether the slot has changed hands since.
      now_held="$(holder)"
      [ "$now_held" = "${announced:-}" ] || {
        echo "waiting up to ${wait_for}s for '$now_held' to finish compiling"
        announced="$now_held"
      }
      sleep "${DOMICILE_COMPILE_SLOT_POLL:-10}"
    done
    if [ -n "$took" ]; then
      echo "$owner" >"$LOCK/owner"
      echo "${RUNNER_NAME:-}" >"$LOCK/runner"
      date +%s >"$LOCK/since"
      date -Is >"$LOCK/since-human"
      echo "took the compile slot as '$owner'"
      exit 0
    fi
    {
      echo "::error::'$(holder)' is still compiling Chromium here ($(age)); waited ${wait_for}s, so this run will not start a second one"
      echo "The slot is at $LOCK, taken $(cat "$LOCK/since-human" 2>/dev/null || echo 'at an unrecorded time')."
      echo
      echo "This machine has 62G and no swap. Two cold Chromium builds in it is"
      echo "an OOM kill, and this machine is also the house's DNS."
      echo
      echo "Once that build is done, re-run this job."
      echo
      echo "If the holder is a run that died, its runner clears this the next"
      echo "time it takes the slot. Anything else only a person can clear:"
      echo
      echo "  rm -rf $LOCK"
    } >&2
    exit 1
    ;;

  drop)
    [ -n "$owner" ] || usage
    # Idempotent, and it has to be: this runs from an `if: always()` step, so
    # it is also reached by a warm run that never took it and by one that
    # failed to.
    [ -d "$LOCK" ] || { echo "no compile slot to drop"; exit 0; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      # Unconditional removal here would let a third run start compiling beside
      # the holder, which is the thing this prevents, reached through it.
      echo "left the compile slot alone: it belongs to '$held', not to '$owner'"
      exit 0
    fi
    rm -rf "$LOCK"
    echo "dropped the compile slot"
    ;;

  wanted)
    [ -n "$owner" ] || usage
    others="$(waiters "$owner")"
    [ -n "$others" ] || { echo "nobody is waiting for the compile slot"; exit 1; }
    printf '%s\n' "$others" | sed "s/.*/waiting for the compile slot: '&'/"
    ;;

  yield)
    [ -n "$owner" ] || usage
    if [ ! -d "$LOCK" ] || [ "$(holder)" != "$owner" ]; then
      echo "::error::'$owner' cannot yield a compile slot it does not hold" >&2
      exit 1
    fi
    rm -rf "$LOCK"
    # Until a waiter has it, so that the caller's next `take` queues behind
    # them rather than winning the race for a slot it has just given up. A
    # waiter polls, so the handover takes up to one of its polls; one that
    # stopped wanting it in the meantime leaves the slot free.
    while [ ! -d "$LOCK" ] && [ -n "$(waiters "$owner")" ]; do
      sleep "${DOMICILE_COMPILE_SLOT_POLL:-10}"
    done
    echo "yielded the compile slot"
    ;;

  who)
    if [ -d "$LOCK" ]; then
      echo "Chromium is being compiled here by '$(holder)' ($(age))"
    else
      echo "nobody is compiling here"
    fi
    ;;

  warm)
    [ -n "$owner" ] || usage
    warm=false
    [ -f "$owner/${OUT_RELEASE:-out/Release}/args.gn" ] &&
      [ "$(cat "$(built_stamp)" 2>/dev/null)" = "$(build_identity)" ] && warm=true
    echo "warm=$warm" >>"${GITHUB_OUTPUT:-/dev/stdout}"
    ;;

  built)
    [ -n "$owner" ] || usage
    build_identity >"$(built_stamp)"
    ;;

  *) usage ;;
esac
