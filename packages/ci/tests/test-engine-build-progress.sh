#!/usr/bin/env bash
# Asserts `engine-build-progress.sh` reads siso's step count out of a build log.
#
# CI prints the build's log only once the build ends, which is hours for a cold
# build.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROGRESS_SH="$ROOT/.github/scripts/engine-build-progress.sh"
[ -x "$PROGRESS_SH" ] || { echo "no $PROGRESS_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    fail "$1" "wanted: $2
    got:    $3"
  fi
}

LOG="$WORK/shell.log"

# siso's lines, as engine-release.yml's log shows them.
cat >"$LOG" <<'EOF2'
depot_tools: /build/depot_tools
[1/1200] 2.00s S CXX obj/base/base/a.o
[299/1201] 9m58.00s F CXX obj/base/base/b.o
[300/1200] 10m00.00s S LINK ./chrome
EOF2
expect "reports the last step count, the time and what is left at that rate" \
  "build progress: 300/1200 steps (25%) in 10m00s, about 30m00s left at this rate" \
  "$("$PROGRESS_SH" "$LOG")"

printf '[56376/112752] 1h02m03.50s F CXX obj/x.o\n' >"$LOG"
expect "reads hours from siso's elapsed time" \
  "build progress: 56376/112752 steps (50%) in 1h02m03s, about 1h02m03s left at this rate" \
  "$("$PROGRESS_SH" "$LOG")"

printf '[0/1200] 1.00s S CXX obj/x.o\n' >"$LOG"
expect "a build with no finished step has no rate" \
  "build progress: no step has finished yet" \
  "$("$PROGRESS_SH" "$LOG")"

# The watcher starts before nix-shell creates the log.
expect "a log not written yet has no step" \
  "build progress: no step has finished yet" \
  "$("$PROGRESS_SH" "$WORK/absent.log")"

printf '[600/1200] 20m00.00s F CXX obj/x.o\n' >"$LOG"
"$PROGRESS_SH" --every 0.2 "$LOG" >"$WORK/every" &
watcher=$!
sleep 1
kill "$watcher"
wait "$watcher" 2>/dev/null
reports="$(grep -c '^build progress: 600/1200 steps (50%)' "$WORK/every")"
if [ "$reports" -ge 2 ]; then ok "--every reports again and again"; else
  fail "--every reports again and again" "reported $reports time(s)"
fi
# The first report waits a period, so it does not read the last build's log
# before nix-shell truncates it.
"$PROGRESS_SH" --every 5 "$LOG" >"$WORK/first" &
watcher=$!
sleep 0.3
kill "$watcher"
wait "$watcher" 2>/dev/null
expect "--every waits a period before its first report" "" "$(cat "$WORK/first")"

[ "$FAILED" -eq 0 ] || exit 1
