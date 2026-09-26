#!/usr/bin/env bash
# The engine group runs the headless webview guards concurrently. They share
# no broker, profile or log, and take free ports rather than fixed ones
# (`test-the-webview-guards-take-free-ports.sh`), and serially they were most
# of the group's wall time. Everything else stays serial and the group still stops at the
# first failure.
#
# And every check but latency runs as noise when the job names itself
# (`CARD_OWNER`), so another run's latency guard waits it out -- and latency
# runs as none, or it would wait out its own run.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

TOGETHER="webview-framing webview-keyboard webview-escape webview-history
  webview-click webview-new-window webview-routed-link control-arrival"

# A repository holding check.sh and a stand-in for every engine check: each
# writes when it started and ended. `bun` is stubbed because the group installs.
mkdir -p "$WORK/repo/scripts" "$WORK/repo/.github/scripts" "$WORK/bin"
cp "$ROOT/scripts/check.sh" "$WORK/repo/scripts/"
cp "$ROOT/.github/scripts/engine-render-node-lock.sh" "$WORK/repo/.github/scripts/"
export DOMICILE_RENDER_NODE_LOCK="$WORK/card" DOMICILE_RENDER_NODE_NOISE="$WORK/noise"
printf '#!/bin/sh\nexit 0\n' >"$WORK/bin/bun"
chmod +x "$WORK/bin/bun"
for script in "$ROOT"/scripts/engine-*.sh; do
  name="$(basename "$script" .sh)"
  cat >"$WORK/repo/scripts/$name.sh" <<STUB
#!/usr/bin/env bash
date +%s.%N >"$WORK/$name.start"
cat "$WORK"/noise/*/owner >"$WORK/$name.noise" 2>/dev/null
case "$name" in (engine-guard-webview-*|engine-guard-control-arrival) sleep 1 ;; esac
[ "\${FAIL:-}" = "$name" ] && { echo "$name broke"; exit 1; }
date +%s.%N >"$WORK/$name.end"
STUB
  chmod +x "$WORK/repo/scripts/$name.sh"
done

check() { # FAIL=<check to fail>
  rm -f "$WORK"/*.start "$WORK"/*.end
  PATH="$WORK/bin:$PATH" DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
    "$WORK/repo/scripts/check.sh" engine >"$WORK/out" 2>&1
}

check
starts=""; ends=""
for g in $TOGETHER; do
  starts="$starts $(cat "$WORK/engine-guard-$g.start" 2>/dev/null)"
  ends="$ends $(cat "$WORK/engine-guard-$g.end" 2>/dev/null)"
done
latest_start="$(printf '%s\n' $starts | sort -n | tail -1)"
earliest_end="$(printf '%s\n' $ends | sort -n | head -1)"
if [ -n "$latest_start" ] && [ -n "$earliest_end" ] &&
   awk "BEGIN { exit !($latest_start < $earliest_end) }"; then
  ok "the webview guards and control-arrival run at the same time"
else
  fail "the webview guards and control-arrival run at the same time" "$(cat "$WORK/out")"
fi

missing=""
for script in "$ROOT"/scripts/engine-*.sh; do
  name="$(basename "$script" .sh)"
  grep -qE "^  $name +ok$" "$WORK/out" || missing="$missing $name"
done
[ -z "$missing" ] && ok "every engine check is reported" ||
  fail "every engine check is reported" "missing:$missing"

# Serial around the batch: the GPU guards before it, latency after it.
latency="$(cat "$WORK/engine-guard-latency.start" 2>/dev/null)"
last_end="$(printf '%s\n' $ends | sort -n | tail -1)"
if [ -n "$latency" ] && awk "BEGIN { exit !($latency >= $last_end) }"; then
  ok "latency waits for the batch"
else
  fail "latency waits for the batch" "latency started $latency, batch ended $last_end"
fi

CARD_OWNER=engine-run-9 check
quiet_ones=""
noisy_ones=""
for script in "$ROOT"/scripts/engine-*.sh; do
  name="$(basename "$script" .sh)"
  if grep -qx engine-run-9 "$WORK/$name.noise" 2>/dev/null; then
    noisy_ones="$noisy_ones $name"
  else
    quiet_ones="$quiet_ones $name"
  fi
done
[ "$quiet_ones" = " engine-guard-latency" ] &&
  ok "every engine check but latency runs as this job's noise" ||
  fail "every engine check but latency runs as this job's noise" \
    "ran as none:$quiet_ones"
[ ! -s "$WORK/engine-guard-latency.noise" ] &&
  ok "and latency runs beside none of it" ||
  fail "and latency runs beside none of it" "$(cat "$WORK/engine-guard-latency.noise")"

FAIL=engine-guard-webview-click check
grep -q "webview-click broke" "$WORK/out" &&
  ok "a failure in the batch shows its log" ||
  fail "a failure in the batch shows its log" "$(cat "$WORK/out")"
[ ! -e "$WORK/engine-guard-latency.start" ] &&
  ok "and nothing after the batch runs" ||
  fail "and nothing after the batch runs" "latency ran"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
