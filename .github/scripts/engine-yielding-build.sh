#!/usr/bin/env bash
# Run a build that steps aside whenever somebody is waiting for the compile
# slot, or for the machine to be quiet enough to time something on.
#
#   .github/scripts/engine-yielding-build.sh <owner> -- <command> [args...]
#
# The caller holds the slot as <owner> on the way in and still holds it on the
# way out. Exits with the command's own status.
#
# The official build takes hours and `crux` has one compile slot
# (engine-compile-slot.sh). Without yielding, every pull request's compile would
# wait for it.
#
# - Every DOMICILE_YIELD_POLL seconds, check whether anyone wants the slot or a
#   quiet machine for a measurement (engine-render-node-lock.sh).
# - If so, stop the build, yield the slot or wait for the measurement, then
#   restart. The build is incremental, so a restart loses only in-flight steps.
# - Stop the whole process group so no compiler keeps running after the slot is
#   handed over. `set -m` because the runner has no `setsid` (util-linux).
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

# Put each background job in its own process group.
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
