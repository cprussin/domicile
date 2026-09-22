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
# EVERY GUARD THAT DRIVES THE CARD, WHICH IS NOT WHAT THIS FIRST SAID. It said
# that a pixel comparison asks whether a color landed, so a second job on the
# card makes it slower and not wrong, and that only `guard-latency.sh` -- sixty
# keystroke-to-pixel rounds -- could be made wrong by one. That premise was
# measured false on 2026-09-22, with `Engine` run 513 and `Pinned engine` run
# 192 on the machine together: run 192's engine died of a broken Wayland pipe
# a second after run 513 entered its own client-window guard, and that guard
# took 67s where it takes 6s alone. A GTX 970 has 4G of VRAM and the two jobs
# each want an engine, a compositor and a nested wlroots on it.
#
# So the scope is the card rather than the clock: taken around every step of
# either job that runs `under-wayland.sh`, and around nothing else.
# `scripts/test-engine-concurrency.sh` is what says so, by reading the
# workflows. It is still NOT taken around a whole job -- the Chromium build,
# the unit tests and the release build touch no render node, and between them
# they are the hours that splitting the slot was for.
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
# four-hour build. Guessing wrong here means two engines on the card at once,
# which costs the two runs that were going and not the afternoon. A canceled
# run is the ordinary way this leaks, and `pinned-engine.yml` cancels
# superseded runs now, so a lock nothing can clear would wedge the every-PR
# job within a day.
#
# THE PRICE OF GUESSING WRONG WENT UP WITH THE HOLD, which is why the stale
# bound moved with it -- see below. It used to be a latency number worth
# re-running; it is now a guard whose engine may not survive the company.
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
# before it is read as abandoned rather than held.
#
# THE STALE BOUND IS A CLAIM ABOUT THE LONGEST LEGITIMATE HOLD, and that hold
# grew by thirty times. It was 600s when `engine.yml` took this around two
# timed steps and `pinned-engine.yml` around a ~65s guard; it is now taken
# around every step of either job that drives the card, because two engines on
# one GTX 970 is not slower, it is one of them dying. Measured on `crux` off
# the jobs API: `engine.yml` holds it for 462s on run 516 (warm tree) and 587s
# on run 495 (a pin roll, whose 3h51m build is outside the hold). 600 would
# have been thirteen seconds of margin over the second of those, and a stale
# bound below the hold does not fail safe -- the waiter steals a card its
# holder is still drawing on, and then both runs are wrong instead of one of
# them being slow.
#
# 900 is that 587 with half again on top. What it costs when it is wrong is a
# lock left by a machine that went away being held onto for fifteen minutes
# instead of ten, which is a wait rather than a wedge: `pinned-engine.yml`'s
# `timeout-minutes: 30` is above both.
#
# AND IT STAYS BELOW MAX_WAIT, which is not decoration. The steal is tried on
# every pass of the loop and the give-up is checked after it, so a stale bound
# at or above the give-up bound is one that never fires -- a leaked lock would
# become a red check on the every-pull-request job rather than a warning and a
# re-run. scripts/test-engine-render-node-lock.sh asserts both numbers.
MAX_WAIT="${DOMICILE_RENDER_NODE_MAX_WAIT:-1200}"
STALE_AFTER="${DOMICILE_RENDER_NODE_STALE_AFTER:-900}"

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
