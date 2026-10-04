#!/usr/bin/env bash
# A machine-wide lock for timed guards, so they measure the engine and not
# other jobs.
#
#   .github/scripts/engine-render-node-lock.sh take <owner>
#   .github/scripts/engine-render-node-lock.sh quiet <owner>
#   .github/scripts/engine-render-node-lock.sh noisy <owner> -- <command...>
#   .github/scripts/engine-render-node-lock.sh drop <owner>
#   .github/scripts/engine-render-node-lock.sh wanted <owner>
#
# `quiet` is `take` for a guard that times something. `noisy` wraps a compile
# or guard that loads the machine.
#
# `crux` runs two CI jobs at once. A Chromium compile on one runner skews
# `guard-latency.sh` on the other even without touching the GPU, so the lock
# covers the whole machine. It is taken only around timed steps and
# `pinned-engine.yml`'s guard; pixel comparisons do not need it.
#
# Unlike engine-tree-lock.sh, this waits instead of failing: the holder runs on
# the other runner, so it can always finish. It also steals a lock older than
# STALE_AFTER, because canceled runs leak it and a wrong steal costs only a
# re-run.
set -u

usage() {
  echo "usage: $(basename "$0") <take|quiet|drop|who|wanted> <owner>" >&2
  echo "       $(basename "$0") noisy <owner> -- <command...>" >&2
  exit 2
}

action="${1:-}"
owner="${2:-}"
[ -n "$action" ] || usage

# Under /build, because `PrivateTmp` gives each runner unit its own /tmp.
# Override for tests.
LOCK="${DOMICILE_RENDER_NODE_LOCK:-/build/.domicile-render-node-lock}"

# How long to wait for the lock, and the age at which it counts as abandoned.
# The longest guarded step takes about 65s.
MAX_WAIT="${DOMICILE_RENDER_NODE_MAX_WAIT:-1200}"
STALE_AFTER="${DOMICILE_RENDER_NODE_STALE_AFTER:-600}"

# `noisy` registers a directory here and `quiet` waits until none are live.
# Each registration refreshes a timestamp every NOISE_BEAT seconds and is dead
# after NOISE_STALE without one. Not a pid, because the runner units may not
# see each other's processes.
NOISE="${DOMICILE_RENDER_NODE_NOISE:-/build/.domicile-noise}"
NOISE_BEAT="${DOMICILE_RENDER_NODE_NOISE_BEAT:-10}"
NOISE_STALE="${DOMICILE_RENDER_NODE_NOISE_STALE:-120}"
# How long a measurement waits for quiet before skipping.
QUIET_WAIT="${DOMICILE_RENDER_NODE_QUIET_WAIT:-1800}"
POLL="${DOMICILE_RENDER_NODE_POLL:-5}"
# Each waiting measurement refreshes a note every poll, so a pausable build
# (engine-yielding-build.sh) can check `wanted`. Notes older than FRESH seconds
# are ignored, since a killed waiter cannot remove its note.
WAITING="$LOCK.waiting"
FRESH="${DOMICILE_RENDER_NODE_FRESH:-60}"

now() { date +%s; }

# A waiter's note, named by a hash because an owner name is free text.
note() { echo "$WAITING/$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)"; }

# Print the owner of each fresh note other than <owner>'s.
waiters() {
  [ -d "$WAITING" ] || return 0
  find "$WAITING" -type f -newermt "-$FRESH seconds" |
    while IFS= read -r waiter; do
      [ "$waiter" = "$(note "$1")" ] || cat "$waiter"
    done
}

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

# Seconds the lock has been held. Fails if unreadable or in the future, so a
# clock change cannot trigger a steal.
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

# Steal a lock older than any guard holds it, with a warning in case a guard
# was still running. At most once per caller.
steal_if_stale() {
  local secs
  [ "$stole" -eq 0 ] || return 1
  secs="$(age_secs)" && [ "$secs" -ge "$STALE_AFTER" ] || return 1
  echo "::warning::the render node lock has been held by '$(holder)' for ${secs}s, which is longer than any guard holds it; taking it"
  echo "If a guard really was still running, its timings are now worth nothing and it should be re-run." >&2
  rm -rf "$LOCK"
  stole=1
}

# Whether the lock is held and not stale. An unreadable age counts as held.
card_in_use() {
  local secs
  [ -d "$LOCK" ] || return 1
  secs="$(age_secs)" || return 0
  [ "$secs" -lt "$STALE_AFTER" ]
}

# Print the owner of each live noise registration. Removes stale ones, which
# belong to killed runs.
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

  # Take the lock once no noise is registered. Check, claim, then check again;
  # `noisy` registers and then checks the lock, so whichever moves second sees
  # the other. The lock is not held while waiting, or it could be held for a
  # whole compile.
  quiet)
    [ -n "$owner" ] || usage
    waited=0
    stole=0
    said=""
    mkdir -p "$WAITING"
    waiting="$(note "$owner")"
    trap 'rm -f "$waiting"' EXIT
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
      echo "$owner" >"$waiting"
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

  # Run the command registered as noise, once no measurement holds the lock.
  # A heartbeat keeps the registration live and stops when this wrapper dies.
  noisy)
    [ -n "$owner" ] && [ "${3:-}" = "--" ] && [ "$#" -ge 4 ] || usage
    shift 3
    mkdir -p "$NOISE" || exit 1
    waited=0
    said=""
    while :; do
      # Check before registering too, to avoid registering just to back off.
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

  wanted)
    [ -n "$owner" ] || usage
    others="$(waiters "$owner")"
    [ -n "$others" ] || { echo "nobody is waiting for a quiet machine"; exit 1; }
    printf '%s\n' "$others" | sed "s/.*/waiting for a quiet machine: '&'/"
    ;;

  drop)
    [ -n "$owner" ] || usage
    # Only drop our own lock. The `if: always()` step also runs when the take
    # failed.
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
