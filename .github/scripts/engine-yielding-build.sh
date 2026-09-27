#!/usr/bin/env bash
# Run a build that steps aside whenever somebody is waiting for the compile
# slot, or for the machine to be quiet enough to time something on.
#
#   .github/scripts/engine-yielding-build.sh <owner> -- <command> [args...]
#
# The caller holds the slot as <owner> on the way in and still holds it on the
# way out. Exits with the command's own status.
#
# WHY. The production engine is an official build -- PGO, ThinLTO, hours long --
# and `crux` has one compile slot (engine-compile-slot.sh). Held for those
# hours, it would queue every pull request's compile, a minute when warm,
# behind it. So while the command runs, this asks every DOMICILE_YIELD_POLL
# seconds whether anybody is `wanted`; if so it stops the command, yields the
# slot to them, takes it back when they are done, and starts the command again.
#
# AND FOR A MEASUREMENT. A pull request's latency guard waits for the machine
# to be quiet (engine-render-node-lock.sh), and an hours-long build is hours of
# noise. That waiter is stepped aside for the same way, except that there is
# nothing to hand over: the build stops, and starts again once nobody is
# waiting, when its own `noisy` waits for the measurement to let go.
#
# STARTING AGAIN IS RESUMING. A build is incremental: what finished before the
# stop is not compiled twice, and only the steps that were running are lost. The
# one step that loses much is a link, and a link is minutes where the build is
# hours.
#
# THE WHOLE PROCESS GROUP IS STOPPED, not just the command: it is a shell that
# starts nix-shell that starts autoninja that starts the compilers, and a
# compiler left running after the slot is handed over is the second compile the
# slot exists to prevent. `set -m` rather than `setsid`, because `setsid` is
# util-linux and the runner's PATH is coreutils and not much else.
set -euo pipefail

owner="${1:-}"
[ -n "$owner" ] && [ "${2:-}" = "--" ] && [ $# -ge 3 ] || {
  echo "usage: $(basename "$0") <owner> -- <command> [args...]" >&2
  exit 2
}
shift 2

HERE="$(cd "$(dirname "$0")" && pwd)"
SLOT="$HERE/engine-compile-slot.sh"
NODE="$HERE/engine-render-node-lock.sh"
POLL="${DOMICILE_YIELD_POLL:-30}"

# Each background job its own process group, so a kill of the group reaches
# everything the command started and nothing else.
set -m

yields=0
while :; do
  "$@" &
  build=$!
  interrupted=""
  while kill -0 "$build" 2>/dev/null; do
    if waiting="$("$SLOT" wanted "$owner")" ||
      waiting="$("$NODE" wanted "$owner")"; then
      interrupted=1
      echo "stopping the build to step aside: $waiting"
      kill -TERM -- "-$build" 2>/dev/null || true
      wait "$build" || true
      break
    fi
    sleep "$POLL"
  done

  if [ -z "$interrupted" ]; then
    status=0
    wait "$build" || status=$?
    echo "the build exited $status, having stepped aside $yields time(s)"
    exit "$status"
  fi

  yields=$((yields + 1))
  if "$SLOT" wanted "$owner" >/dev/null; then
    "$SLOT" yield "$owner"
    "$SLOT" take "$owner"
  fi
  while "$NODE" wanted "$owner" >/dev/null; do
    sleep "$POLL"
  done
  echo "resuming the build"
done
