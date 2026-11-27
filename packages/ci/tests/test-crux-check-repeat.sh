#!/usr/bin/env bash
# Checks that `.github/scripts/crux-check-repeat.sh` runs a check the number
# of times asked, counts its failures, prints only the failing runs' logs,
# starts each run with none of the last run's logs, holds the render node
# around each run alone and pauses after each drop, says when a run was
# killed, and stops at once on a check run-checks.sh did not run.
#
# A stand-in for run-checks.sh exits as each run is told to and writes a log
# naming its run. Stand-ins for the render node lock and the pause write
# down each take, drop and pause.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/crux-check-repeat.sh"
[ -x "$SCRIPT" ] || { echo "no $SCRIPT" >&2; exit 1; }

WORK="$(mktemp -d)"
LOG="$WORK/domicile-check.log"
trap 'rm -rf "$WORK"' EXIT

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

# The stand-in for run-checks.sh: counts its runs, says whether the last
# run's log is still there and whether it runs under the render node, writes
# its own log, and exits with EXITS' word for its run (0 when none).
cat >"$WORK/run-checks" <<STUB
#!/usr/bin/env bash
run=\$((\$(cat "$WORK/count" 2>/dev/null || echo 0) + 1))
echo "\$run" >"$WORK/count"
[ -f "$LOG" ] && echo "stale log at run \$run"
[ -f "$WORK/held" ] || echo "run \$run without the render node"
echo "log of run \$run" >"$LOG"
echo "checked \$1 control=\${DOMICILE_GUARD_CONTROL:-unset}"
set -- \$EXITS
shift \$((run - 1)) 2>/dev/null || set --
[ "\${1:-0}" = hang ] && exec sleep 30
exit "\${1:-0}"
STUB
cat >"$WORK/lock" <<STUB
#!/usr/bin/env bash
echo "\$1 \$2" >>"$WORK/locks"
case "\$1" in take) : >"$WORK/held"; [ -z "\${TAKE_FAILS:-}" ] ;; drop) rm -f "$WORK/held" ;; esac
STUB
cat >"$WORK/pause" <<STUB
#!/usr/bin/env bash
echo "pause \$1" >>"$WORK/locks"
STUB
chmod +x "$WORK/run-checks" "$WORK/lock" "$WORK/pause"

repeat() { # exits, times, [check]
  rm -f "$WORK/count" "$WORK/locks" "$WORK/held" "$WORK/summary"
  EXITS="$1" LOG_DIR="$WORK" RUN_CHECKS="$WORK/run-checks" \
    RENDER_NODE_LOCK="$WORK/lock" PAUSE="$WORK/pause" RUN_TIMEOUT=2 \
    CARD_OWNER="${OWNER-owner}" \
    GITHUB_STEP_SUMMARY="$WORK/summary" DOMICILE_GUARD_CONTROL=0 \
    "$SCRIPT" "${3:-guard-x}" "$2" >"$WORK/out" 2>&1
  echo $?
}

echo "a check that fails some runs"
expect "fails" "1" "$(repeat "0 1 0 1 0" 5)"
expect "ran as many times as asked" "5" "$(cat "$WORK/count")"
expect "counts the failures" "guard-x: 2 of 5 runs failed" "$(tail -1 "$WORK/out")"
expect "and writes them to the step summary" "guard-x: 2 of 5 runs failed" \
  "$(tail -1 "$WORK/summary")"
expect "prints the failing runs' logs" "log of run 2 log of run 4" \
  "$(grep '^log of run' "$WORK/out" | tr '\n' ' ' | sed 's/ $//')"
expect "starts each run with no log" "0" "$(grep -c 'stale log' "$WORK/out")"
expect "passes the check's name and control" "5" \
  "$(grep -c '^checked guard-x control=0$' "$WORK/out")"
expect "holds the render node for every run" "0" \
  "$(grep -c 'without the render node' "$WORK/out")"
expect "and drops it after each, then pauses past the lock's polls" \
  "$(printf 'take owner\ndrop owner\npause 15\n%.0s' 1 2 3 4 5)" \
  "$(cat "$WORK/locks")"

echo
echo "a run that hangs"
expect "fails" "1" "$(repeat "hang 0" 2)"
expect "and says it was killed" "1" \
  "$(grep -c '^run 1: FAILED, ran past 2s and was killed$' "$WORK/out")"
expect "and goes on to the next run" "2" "$(cat "$WORK/count")"

echo
echo "a check that never fails"
expect "passes" "0" "$(repeat "" 3)"
expect "says none failed" "guard-x: 0 of 3 runs failed" "$(tail -1 "$WORK/out")"
expect "prints no logs" "0" "$(grep -c '^log of run' "$WORK/out")"

echo
echo "a check run-checks.sh did not run"
expect "a skip stops at once with the skip" "77" "$(repeat "0 77 0" 3)"
expect "after the run that skipped" "2" "$(cat "$WORK/count")"
expect "and drops the render node" "drop owner" "$(tail -2 "$WORK/locks" | head -1)"
expect "an unknown check stops at once" "2" "$(repeat "2 2 2" 3)"
expect "after one run" "1" "$(cat "$WORK/count")"

echo
echo "what it refuses before any run"
# Exits 2 and ran nothing when the arguments are refused.
refuses() { # times, [check]
  local status
  status="$(repeat "" "$@")"
  echo "$status $(cat "$WORK/count" 2>/dev/null || echo none)"
}
expect "a count that isn't a number" "2 none" "$(refuses x)"
expect "no runs" "2 none" "$(refuses 0)"
expect "more runs than a job takes" "2 none" "$(refuses 51)"
expect "a name that isn't a check's" "2 none" "$(refuses 1 'guard-x
::error::')"
expect "guard-latency, which takes the render node itself" "2 none" \
  "$(refuses 1 guard-latency)"
expect "no one to hold the render node" "2 none" "$(OWNER='' refuses 1)"
expect "a render node it could not take" "1 none" "$(TAKE_FAILS=1 refuses 1)"
"$SCRIPT" guard-x >/dev/null 2>&1
expect "the wrong number of arguments" "2" "$?"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "crux-check-repeat counts and shows the failing runs"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
