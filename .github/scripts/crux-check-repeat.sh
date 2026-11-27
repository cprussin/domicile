#!/usr/bin/env bash
# Runs one engine check many times against the same build and says how many
# times it failed, with each failing run's logs.
#
#   CARD_OWNER=<owner> DOMICILE_CHROMIUM=<engine> DOMICILE_ENGINE_OUT=. \
#     .github/scripts/crux-check-repeat.sh <check> <times>
#
# engine-check-repeat.yml runs this on `crux-light` against the pinned engine.
# A check that fails some runs of an unchanged build is a bug in the check or
# in the engine, never something to retry past, and the failing runs' logs are
# what shows which. Each run starts with no `domicile-*.log` in the log
# directory, so a run's logs are its own.
#
# Each run takes the render node and drops it after, as pinned-engine.yml's
# one guard does, then pauses longer than the lock's waiters poll before the
# next. Without the pause the next take comes milliseconds after the drop, no
# waiter on the other runner ever gets in, and engine.yml's compile and latency
# steps give up. Holding it across every run instead would outlast the lock's
# STALE_AFTER, so another job would steal it mid-run.
#
# Exits 0 if no run failed and 1 if any did. A check run-checks.sh doesn't know
# (exit 2) or skips (exit 77) stops the loop at once with that status, since
# counting it as a failure every run would read as a flaky check.
# `DOMICILE_GUARD_CONTROL` passes through to run-checks.sh, so 0 runs the
# claim alone.
#
# Not named `engine-*.sh`: engine.yml runs on a change to those, and this is
# not one of its steps.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Overridable so packages/ci/tests/test-crux-check-repeat.sh can stand in for
# them.
RUN_CHECKS="${RUN_CHECKS:-$ROOT/packages/domicile-engine/scripts/run-checks.sh}"
RENDER_NODE_LOCK="${RENDER_NODE_LOCK:-$ROOT/.github/scripts/engine-render-node-lock.sh}"
LOG_DIR="${LOG_DIR:-/tmp}"
# The most runs one job takes: at about four minutes a run, with the pauses,
# fifty fit the job's 240. Slower runs fit fewer.
MOST_TIMES="${MOST_TIMES:-50}"
# Each run's limit: under the render node lock's STALE_AFTER of 600 s, so no
# one steals the lock from a run still going.
RUN_TIMEOUT="${RUN_TIMEOUT:-540}"
# The pause after each drop: three of the lock's 5 s polls.
PAUSE_SECONDS="${PAUSE_SECONDS:-15}"
# Overridable so the test can see the pause without waiting for it.
PAUSE="${PAUSE:-sleep}"
# Lines of each log to print for a failing run.
LOG_LINES="${LOG_LINES:-400}"
# Where the tally goes, run by run, so a job killed partway still has it.
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

usage() {
  echo "usage: $(basename "$0") <check> <times>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
CHECK="$1"
TIMES="$2"
[ -n "${CARD_OWNER:-}" ] || { echo "CARD_OWNER names no one to hold the render node" >&2; exit 2; }
[[ "$CHECK" =~ ^[a-z0-9-]+$ ]] || { echo "'$CHECK' is not a check's name" >&2; exit 2; }
[[ "$TIMES" =~ ^[1-9][0-9]*$ ]] || { echo "'$TIMES' is not a number of runs" >&2; exit 2; }
[ "$TIMES" -le "$MOST_TIMES" ] || { echo "$TIMES runs is more than one job's $MOST_TIMES" >&2; exit 2; }
# check-latency.sh takes the render node itself, under the same owner.
[ "$CHECK" != guard-latency ] || { echo "guard-latency takes the render node itself; run it from engine.yml" >&2; exit 2; }

echo "## $CHECK, $TIMES runs" >>"$SUMMARY"
failed=0
for run in $(seq 1 "$TIMES"); do
  rm -f "$LOG_DIR"/domicile-*.log
  "$RENDER_NODE_LOCK" take "$CARD_OWNER" >&2 || { echo "could not take the render node" >&2; exit 1; }
  echo "::group::$CHECK, run $run of $TIMES"
  timeout -k 30 "$RUN_TIMEOUT" "$RUN_CHECKS" "$CHECK"
  status=$?
  echo "::endgroup::"
  "$RENDER_NODE_LOCK" drop "$CARD_OWNER" >&2
  # Lets a job waiting on the other runner take the render node.
  "$PAUSE" "$PAUSE_SECONDS"
  case "$status" in
  0)
    echo "run $run: passed" | tee -a "$SUMMARY"
    continue
    ;;
  2 | 77)
    echo "run $run: run-checks.sh did not run $CHECK (exit $status); stopping" | tee -a "$SUMMARY" >&2
    exit "$status"
    ;;
  esac
  failed=$((failed + 1))
  # 124 is timeout's own: the run ran past it. A 137 may be any SIGKILL.
  if [ "$status" -eq 124 ]; then
    echo "run $run: FAILED, ran past ${RUN_TIMEOUT}s and was killed" | tee -a "$SUMMARY"
  else
    echo "run $run: FAILED (exit $status)" | tee -a "$SUMMARY"
  fi
  for log in "$LOG_DIR"/domicile-*.log; do
    [ -f "$log" ] || continue
    echo "::group::run $run: $log (last $LOG_LINES lines)"
    tail -n "$LOG_LINES" "$log"
    echo "::endgroup::"
  done
done

echo "$CHECK: $failed of $TIMES runs failed" | tee -a "$SUMMARY"
[ "$failed" -eq 0 ]
