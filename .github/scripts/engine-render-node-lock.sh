#!/usr/bin/env bash
# One job at a time on this machine's render node, so a timed guard is timing
# the engine and not the other runner.
#
#   .github/scripts/engine-render-node-lock.sh take <owner>
#   .github/scripts/engine-render-node-lock.sh drop <owner>
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
  echo "usage: $(basename "$0") <take|drop|who> <owner>" >&2
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

case "$action" in
  take)
    [ -n "$owner" ] || usage
    waited=0
    stole=0
    while :; do
      if mkdir "$LOCK" 2>/dev/null; then
        printf '%s\n' "$owner" >"$LOCK/owner"
        now >"$LOCK/since"
        date -Is >"$LOCK/since-human"
        if [ "$waited" -gt 0 ]; then
          echo "took the render node as '$owner' after ${waited}s"
        else
          echo "took the render node as '$owner'"
        fi
        exit 0
      fi

      # Held. Before waiting on it, decide whether there is anything there to
      # wait for: a lock older than any guard could possibly hold it is a run
      # that was canceled or a machine that went away, and nothing else clears
      # it. Said loudly rather than quietly, because the one case where this is
      # wrong -- a guard genuinely taking ten minutes -- is worth a line in a
      # log that somebody can find afterward.
      if secs="$(age_secs)" && [ "$secs" -ge "$STALE_AFTER" ] && [ "$stole" -eq 0 ]; then
        echo "::warning::the render node lock has been held by '$(holder)' for ${secs}s, which is longer than any guard holds it; taking it"
        echo "If a guard really was still running, its timings are now worth nothing and it should be re-run." >&2
        rm -rf "$LOCK"
        stole=1
        continue
      fi

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
