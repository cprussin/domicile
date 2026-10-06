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
# `warm` writes `warm=true` to $GITHUB_OUTPUT only if `built` recorded this
# applied series and these build scripts. A tree can carry the series with a
# cold out/Release.
#
# `crux` has 62G and no swap (cprussin/dotfiles: config/machines/crux), and a
# cold Chromium link uses most of it. Two at once gets OOM-killed. Only runs
# that will compile take the slot, so warm runs never wait behind a repin.
#
# Rules:
# - `take` waits up to DOMICILE_COMPILE_SLOT_WAIT seconds (default 30 minutes),
#   then fails. engine.yml waits longer to outlast a cold repin
#   (scripts/test-the-engine-budget-holds-both-builds.sh).
# - Age never frees the slot: a cold build can take five hours.
# - A runner clears a slot left by an earlier job on itself, since it runs one
#   job at a time. A person's build records no runner and is never cleared.
# - Waiters refresh a note beside the slot each poll. `wanted` reports fresh
#   notes from others, and `yield` drops the slot and waits until a waiter
#   takes it. The long production build uses this to let PR builds through.
#   Notes older than DOMICILE_COMPILE_SLOT_FRESH seconds are ignored, since a
#   killed waiter cannot remove its note.
# - DOMICILE_COMPILE_SLOT_RANK goes on the note, and `wanted` and `yield` count
#   only notes that outrank the holder, so two holders cannot pass the slot
#   back and forth. Unset ranks highest. engine-release.yml uses 0 and
#   engine.yml's cold builds use 1.
set -u

usage() {
  echo "usage: $(basename "$0") <take|drop|who|wanted|yield> [owner]" >&2
  echo "       $(basename "$0") <warm|built> <chromium/src>" >&2
  exit 2
}

action="${1:-}"
owner="${2:-}"
[ -n "$action" ] || usage

# Under /build, because `PrivateTmp` gives each runner unit its own /tmp.
# Override for tests.
LOCK="${DOMICILE_COMPILE_SLOT:-/build/.domicile-compile-slot}"
# Beside the slot, because a drop removes the slot and the notes must survive.
WAITING="$LOCK.waiting"

HERE="$(cd "$(dirname "$0")" && pwd)"
built_stamp() { echo "${DOMICILE_BUILT_STAMP:-$(dirname "$owner")/.domicile-built}"; }
# The series stamp names the commit the apply made, so a re-apply whose build
# died is not warm.
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

# A waiter's note, named by a hash because an owner name is free text.
note() { echo "$WAITING/$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)"; }

# Print the owner of each fresh note, other than <owner>'s, that outranks this
# holder. A note's second line is its rank. A note with no rank outranks every
# holder, and a holder with no rank counts every note.
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
      # Stop waiting if the run is superseded. The check exits 0 for wanted,
      # 1 for not wanted, and anything else for unknown, which keeps waiting.
      # Checked before the first take too, since engine.yml may have queued
      # this run for a long time already.
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
      # Clear the slot if the holder's run is over on any runner, since a
      # runner shut down mid-build never drops it. Only a definite yes clears
      # it, so a run still in progress keeps it.
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
      # Write and rename, so a holder never reads a partial note. A note
      # missing its rank would outrank everyone.
      printf '%s\n' "$owner" ${DOMICILE_COMPILE_SLOT_RANK:+"$DOMICILE_COMPILE_SLOT_RANK"} >"$waiting.tmp"
      mv "$waiting.tmp" "$waiting"
      # Announce each new holder, so the log shows when the slot changes hands.
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
    # Idempotent: the `if: always()` step also runs when the slot was never
    # taken.
    [ -d "$LOCK" ] || { echo "no compile slot to drop"; exit 0; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      # Removing another owner's slot would let a second compile start.
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
    # Wait until a waiter takes it, so the caller's next `take` does not win
    # it straight back. If the waiters leave, the slot stays free.
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
