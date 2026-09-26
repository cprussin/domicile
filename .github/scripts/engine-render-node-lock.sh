#!/usr/bin/env bash
# One job at a time on this machine's render node, so a timed guard is timing
# the engine and not the other runner.
#
#   .github/scripts/engine-render-node-lock.sh take <owner>
#   .github/scripts/engine-render-node-lock.sh quiet <owner>
#   .github/scripts/engine-render-node-lock.sh noisy <owner> -- <command...>
#   .github/scripts/engine-render-node-lock.sh drop <owner>
#
# `quiet` is `take` for a guard that times something, and `noisy` is how a
# compile or a guard says it is loading the machine; see them below.
#
# THE CARD ALONE WAS NOT ENOUGH. Main run 36226737213 held it and its latency
# guard read floor 44.61 ms, commit to pixel 49.04 ms and an unanswered round;
# PR #598's run read 38.80 ms against a 33.33 ms bar. Both ran while run
# 36228817911 compiled Chromium on the other runner; quiet runs read 19-29 ms.
# A compile never touches the card, so the lock must cover the machine.
#
# WHY THIS EXISTS NOW AND DID NOT BEFORE. `crux` had one job slot, and one slot
# is a lock over everything the machine has -- the card included. It has two
# now (cprussin/dotfiles: config/machines/crux/domicile-ci.nix), because the
# job that runs on every pull request never opens the Chromium tree and was
# spending hours in front of it: 1m51s of work behind 3h01m of queue, measured
# 2026-09-19. Splitting the queue gave back those hours and gave away the one
# thing the single slot was quietly providing.
#
# MOST GUARDS DO NOT CARE, AND ONE DOES. A pixel comparison asks whether a
# color landed; a second job on the card makes it slower and does not make it
# wrong. `guard-latency.sh` asks what a keystroke costs to reach a pixel, over
# sixty rounds, and a concurrent job is indistinguishable from the regression
# it exists to catch. So this is not taken around every guard -- that would put
# the two runners back into one queue and undo the change that created it. It
# is taken around the steps that time something, and `pinned-engine.yml`'s
# guard, which is the only thing on the other runner that can perturb them.
#
# IT WAITS, WHERE THE TREE LOCK REFUSES, AND THE DIFFERENCE IS THE SLOT COUNT.
# `engine-tree-lock.sh` refuses and exits 1 because on a one-slot machine a run
# that waits is a run already holding the slot the holder needs in order to
# finish -- a deadlock rather than a queue. That argument does not survive the
# second runner: a job waiting here holds its own runner's slot and the holder
# holds the other one, so the holder can always finish. Neither direction can
# starve the other, and the longest hold is a guard rather than a build.
#
# AND IT STEALS A LOCK THAT IS TOO OLD, WHERE THE TREE LOCK WILL NOT. That is
# the same difference read the other way. A stale tree lock must be cleared by
# a person because guessing wrong means a reset landing inside somebody's
# four-hour build. Guessing wrong here means one guard runs beside another job
# and may report a latency it should not -- a re-run, not a lost afternoon. A
# canceled run is the ordinary way this leaks, and `pinned-engine.yml` cancels
# superseded runs now, so a lock nothing can clear would wedge the every-PR
# job within a day.
set -u

usage() {
  echo "usage: $(basename "$0") <take|quiet|drop|who> <owner>" >&2
  echo "       $(basename "$0") noisy <owner> -- <command...>" >&2
  exit 2
}

action="${1:-}"
owner="${2:-}"
[ -n "$action" ] || usage

# Under /build rather than /tmp, for the reason everything else on this machine
# is: the runner units set TMPDIR=/build/tmp, but `PrivateTmp` is per-service
# and /tmp is therefore NOT shared between the two runners -- which is exactly
# what a lock between them cannot be. /build is a real mount both units have
# `ReadWritePaths` over. Override for tests, which have no /build.
LOCK="${DOMICILE_RENDER_NODE_LOCK:-/build/.domicile-render-node-lock}"

# How long to wait for the card before giving up, and how old a lock has to be
# before it is read as abandoned rather than held. The stale bound is above the
# longest run of guarded steps by a wide margin -- the timed steps are seconds
# and `pinned-engine.yml`'s guard is ~65s -- so a lock older than this is not a
# job that is taking its time.
MAX_WAIT="${DOMICILE_RENDER_NODE_MAX_WAIT:-1200}"
STALE_AFTER="${DOMICILE_RENDER_NODE_STALE_AFTER:-600}"

# Noise: what `noisy` registers and `quiet` waits out. One directory per
# registration, beside the lock and for the same reason. A registration says it
# is alive every NOISE_BEAT seconds and is dead after NOISE_STALE without that:
# a pid cannot say so, because the two runners are two units that need not see
# each other's processes.
NOISE="${DOMICILE_RENDER_NODE_NOISE:-/build/.domicile-noise}"
NOISE_BEAT="${DOMICILE_RENDER_NODE_NOISE_BEAT:-10}"
NOISE_STALE="${DOMICILE_RENDER_NODE_NOISE_STALE:-120}"
# How long a measurement waits for quiet before saying it did not run.
QUIET_WAIT="${DOMICILE_RENDER_NODE_QUIET_WAIT:-1800}"
POLL="${DOMICILE_RENDER_NODE_POLL:-5}"

now() { date +%s; }

held_since() {
  local since
  since="$(cat "$LOCK/since" 2>/dev/null || true)"
  case "$since" in
    (''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$since"
}

holder() {
  cat "$LOCK/owner" 2>/dev/null || echo "someone who did not write their name in it"
}

# Seconds the current lock has been held, or nothing when that cannot be read.
# A lock from the future is a clock that moved rather than a lock held for -3h,
# and it is treated as ageless so that nothing steals it on the strength of it.
age_secs() {
  local since secs
  since="$(held_since)" || return 1
  secs=$(($(now) - since))
  [ "$secs" -ge 0 ] || return 1
  printf '%s\n' "$secs"
}

claim() {
  mkdir "$LOCK" 2>/dev/null || return 1
  printf '%s\n' "$owner" >"$LOCK/owner"
  now >"$LOCK/since"
  date -Is >"$LOCK/since-human"
}

# Held. Before waiting on it, decide whether there is anything there to wait
# for: a lock older than any guard could possibly hold it is a run that was
# canceled or a machine that went away, and nothing else clears it. Said loudly
# rather than quietly, because the one case where this is wrong -- a guard
# genuinely taking ten minutes -- is worth a line in a log that somebody can
# find afterward. Once per caller, in `stole`.
steal_if_stale() {
  local secs
  [ "$stole" -eq 0 ] || return 1
  secs="$(age_secs)" && [ "$secs" -ge "$STALE_AFTER" ] || return 1
  echo "::warning::the render node lock has been held by '$(holder)' for ${secs}s, which is longer than any guard holds it; taking it"
  echo "If a guard really was still running, its timings are now worth nothing and it should be re-run." >&2
  rm -rf "$LOCK"
  stole=1
}

# Held and not abandoned, which is what noise holds off for. An age that cannot
# be read is held, for the reason `take` will not steal it.
card_in_use() {
  local secs
  [ -d "$LOCK" ] || return 1
  secs="$(age_secs)" || return 0
  [ "$secs" -lt "$STALE_AFTER" ]
}

# The owners of live noise, one per line. A registration that stopped saying
# it is alive is a run that was killed: cleared, out loud, rather than waited
# on, or every measurement after it is a skip.
live_noise() {
  local reg since who
  for reg in "$NOISE"/*; do
    [ -d "$reg" ] || continue
    who="$(cat "$reg/owner" 2>/dev/null || echo "someone who did not write their name in it")"
    since="$(cat "$reg/since" 2>/dev/null || true)"
    case "$since" in
      (''|*[!0-9]*) ;;
      (*)
        if [ $(($(now) - since)) -ge "$NOISE_STALE" ]; then
          echo "::warning::'$who' registered noise and has not said it is alive for $(($(now) - since))s; clearing $reg" >&2
          rm -rf "$reg"
          continue
        fi
        ;;
    esac
    printf '%s\n' "$who"
  done
}

case "$action" in
  take)
    [ -n "$owner" ] || usage
    waited=0
    stole=0
    while :; do
      if claim; then
        if [ "$waited" -gt 0 ]; then
          echo "took the render node as '$owner' after ${waited}s"
        else
          echo "took the render node as '$owner'"
        fi
        exit 0
      fi

      steal_if_stale && continue

      if [ "$waited" -ge "$MAX_WAIT" ]; then
        {
          echo "::error::the render node is still held by '$(holder)' after ${waited}s, so this step will not run beside it"
          echo "The lock is at $LOCK, taken $(cat "$LOCK/since-human" 2>/dev/null || echo 'at an unrecorded time')."
          echo
          echo "It exists because this machine now runs two jobs at once and one"
          echo "of the guards times what a keystroke costs to reach a pixel. A"
          echo "second job on the card is indistinguishable from the regression"
          echo "that guard is there to catch."
          echo
          echo "Waiting this long means neither the holder finished nor the lock"
          echo "aged past ${STALE_AFTER}s, which should not both be true. If nothing"
          echo "is running on the machine, this clears it:"
          echo
          echo "  rm -rf $LOCK"
        } >&2
        exit 1
      fi

      sleep 5
      waited=$((waited + 5))
    done
    ;;

  # `take`, for a guard that times something: the card only once nothing on
  # the machine is noise, and noise holds off until it is dropped. Look, claim,
  # look again -- and `noisy` registers, then looks at the card -- so whichever
  # of the two moves second sees the first. Never while waiting, since a card
  # held for a compile's length would be stolen at STALE_AFTER and would hold
  # `pinned-engine.yml` off for as long.
  quiet)
    [ -n "$owner" ] || usage
    waited=0
    stole=0
    said=""
    while :; do
      noise="$(live_noise)"
      if [ -z "$noise" ]; then
        if claim; then
          noise="$(live_noise)"
          if [ -z "$noise" ]; then
            echo "took the render node as '$owner' after ${waited}s, with nothing else compiling or running guards here"
            exit 0
          fi
          rm -rf "$LOCK"
        else
          steal_if_stale && continue
        fi
      fi
      what="${noise:-the render node, held by '$(holder)'}"
      what="$(printf '%s\n' "$what" | paste -sd, - | sed 's/,/, /g')"
      [ "$what" = "$said" ] || {
        echo "waiting up to ${QUIET_WAIT}s for a quiet machine: $what"
        said="$what"
      }
      if [ "$waited" -ge "$QUIET_WAIT" ]; then
        echo "SKIP: the machine was never quiet enough to time anything on (${waited}s): $what"
        {
          echo "::notice::'$owner' timed nothing: after ${waited}s this machine still had $what"
          echo "A measurement taken beside a compile or another run's guards"
          echo "measures the machine, not the pipeline. Re-run this once it is quiet."
        } >&2
        exit 77
      fi
      sleep "$POLL"
      waited=$((waited + POLL))
    done
    ;;

  # A compile or a guard: the command runs registered as noise, and not while a
  # measurement holds the card. A heartbeat keeps the registration live and dies
  # with this wrapper, even one killed outright.
  noisy)
    [ -n "$owner" ] && [ "${3:-}" = "--" ] && [ "$#" -ge 4 ] || usage
    shift 3
    mkdir -p "$NOISE" || exit 1
    waited=0
    said=""
    while :; do
      # Looked at before registering as well as after, so a registration that
      # only exists to back off again is rare rather than every poll.
      if ! card_in_use; then
        staged="$(mktemp -d "$NOISE/.new.XXXXXX")" || exit 1
        printf '%s\n' "$owner" >"$staged/owner"
        now >"$staged/since"
        reg="$NOISE/${staged##*/.new.}"
        mv "$staged" "$reg" || exit 1
        card_in_use || break
        rm -rf "$reg"
      fi
      [ "$(holder)" = "$said" ] || {
        said="$(holder)"
        echo "waiting up to ${MAX_WAIT}s for '$said' to finish with the render node before '$owner' starts"
      }
      if [ "$waited" -ge "$MAX_WAIT" ]; then
        echo "::error::'$owner' will not start beside '$(holder)', which has held the render node for ${waited}s; the lock is at $LOCK" >&2
        exit 1
      fi
      sleep "$POLL"
      waited=$((waited + POLL))
    done
    me=$$
    ( while kill -0 "$me" 2>/dev/null && [ -d "$reg" ]; do
        now >"$reg/since"
        sleep "$NOISE_BEAT"
      done
      rm -rf "$reg"
    ) </dev/null >/dev/null 2>&1 &
    beat=$!
    trap 'kill "$beat" 2>/dev/null; rm -rf "$reg"' EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT
    "$@"
    exit
    ;;

  drop)
    [ -n "$owner" ] || usage
    # ONLY IF IT IS STILL OURS. The step that drops this runs `if: always()`,
    # so it is also reached by a run that failed to take the lock in the first
    # place -- and an unconditional `rm` there would hand the card to a third
    # job in the middle of the holder's timed guard. The tree lock learned this
    # the same way.
    if [ ! -d "$LOCK" ]; then
      echo "the render node was not locked"
      exit 0
    fi
    mine="$(holder)"
    if [ "$mine" != "$owner" ]; then
      echo "the render node is '$mine's, not '$owner's; leaving it alone"
      exit 0
    fi
    rm -rf "$LOCK"
    echo "dropped the render node"
    ;;

  who)
    if [ -d "$LOCK" ]; then
      echo "$(holder) ($(age_secs || echo unknown)s)"
    else
      echo "nobody"
    fi
    ;;

  *) usage ;;
esac
