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
expect "reports the last step count and what is left at that rate" \
  "build progress: 300/1200 steps (25%), about 30m00s left at this rate" \
  "$("$PROGRESS_SH" "$LOG")"

printf '[56376/112752] 1h02m03.50s F CXX obj/x.o\n' >"$LOG"
expect "reads hours from siso's elapsed time" \
  "build progress: 56376/112752 steps (50%), about 1h02m03s left at this rate" \
  "$("$PROGRESS_SH" "$LOG")"

printf '[0/1200] 1.00s S CXX obj/x.o\n' >"$LOG"
expect "a build with no finished step has no rate" \
  "build progress: no step has finished yet" \
  "$("$PROGRESS_SH" "$LOG")"

# The watcher starts before nix-shell creates the log.
expect "a log not written yet has no step" \
  "build progress: no step has finished yet" \
  "$("$PROGRESS_SH" "$WORK/absent.log")"

# A restarted build counts again from 1, with only the steps left as its total.
TOTAL="$WORK/total"
printf '[100/1000] 10m00.00s F CXX obj/x.o\n' >"$LOG"
"$PROGRESS_SH" --total "$TOTAL" "$LOG" >/dev/null
printf '[200/800] 5m00.00s F CXX obj/x.o\n' >"$LOG"
expect "--total counts the whole job's steps across a restart" \
  "build progress: 400/1000 steps (40%), about 15m00s left at this rate" \
  "$("$PROGRESS_SH" --total "$TOTAL" "$LOG")"

printf '[600/1200] 20m00.00s F CXX obj/x.o\n' >"$LOG"
"$PROGRESS_SH" --every 0.2 "$LOG" >"$WORK/every" &
watcher=$!
sleep 1
kill "$watcher"
wait "$watcher" 2>/dev/null
reports="$(grep -c '^build progress: 600/1200 steps (50%)' "$WORK/every")"
expect "--every says when no step finished in a period" \
  "build progress: 600/1200 steps (50%), about 20m00s left at this rate; no step finished in the last 0m00s" \
  "$(sed -n 2p "$WORK/every")"
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

# --status posts each report as the commit's pending status.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do last="$a"; done
printf '%s %s\n' "$last" "$(printf '%s\n' "$@" | grep -A1 -x -- -d | tail -1)" >>"$WORK_DIR/posted"
STUB
chmod +x "$WORK/bin/curl"
WORK_DIR="$WORK" PATH="$WORK/bin:$PATH" GH_TOKEN=t GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=7 \
  GITHUB_WORKFLOW=Engine "$PROGRESS_SH" --every 0.2 --status abc "$LOG" >/dev/null &
watcher=$!
sleep 0.5
kill "$watcher"
wait "$watcher" 2>/dev/null
expect "--status posts the report as a pending status" \
  'https://api.github.com/repos/o/r/statuses/abc {"state":"pending","context":"Engine / build progress","description":"600/1200 steps (50%), about 20m00s left at this rate","target_url":"https://github.com/o/r/actions/runs/7"}' \
  "$(head -1 "$WORK/posted")"

# GitHub refusing a status does not stop the reports.
printf '#!/usr/bin/env bash\necho "curl: (22) 403" >&2\nexit 22\n' >"$WORK/bin/curl"
PATH="$WORK/bin:$PATH" GH_TOKEN=t GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=7 \
  GITHUB_WORKFLOW=Engine "$PROGRESS_SH" --every 0.2 --status abc "$LOG" >"$WORK/refused" &
watcher=$!
sleep 1
kill "$watcher"
wait "$watcher" 2>/dev/null
reports="$(grep -c '^build progress: ' "$WORK/refused")"
if [ "$reports" -ge 2 ] && grep -q '^could not post the build.s status to abc: curl: (22) 403' "$WORK/refused"; then
  ok "a refused status is reported and the reports go on"
else
  fail "a refused status is reported and the reports go on" "$(cat "$WORK/refused")"
fi

[ "$FAILED" -eq 0 ] || exit 1
