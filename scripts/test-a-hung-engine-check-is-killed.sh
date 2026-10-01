#!/usr/bin/env bash
# An engine check that never returns is killed and fails, rather than holding
# the job until its 12-hour timeout. Engine run 36820989982 hung in the webview
# batch at 06:51; its guards stayed registered as noise, so run 36820571967's
# latency guard waited on them on the other runner, and the two held both of
# `crux`'s slots until they were canceled at 14:25.
#
# Killed means all of it: the check, what it started, and its noise -- or the
# other run's latency guard is still waiting.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'pkill -f "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

command -v timeout >/dev/null 2>&1 || { echo "SKIP: no timeout(1)"; exit 77; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# A repository holding check.sh and a stand-in for every engine check. The one
# named in HANG starts a child and then sleeps far past the budget, the way a
# guard waiting on a browser that never answers does.
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
if [ "\${HANG:-}" = "$name" ]; then
  echo "$name is waiting on a browser"
  sh -c 'echo \$\$ >"$WORK/child.pid"; exec sleep 300 # $WORK' &
  sleep 300
fi
exit 0
STUB
  chmod +x "$WORK/repo/scripts/$name.sh"
done

hung_check() { # <check to hang>
  local started
  started="$(date +%s)"
  HANG="$1" CARD_OWNER=engine-run-9 PATH="$WORK/bin:$PATH" \
    DOMICILE_ENGINE_CHECK_TIMEOUT=2 DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
    timeout 60 "$WORK/repo/scripts/check.sh" engine >"$WORK/out" 2>&1
  status=$?
  took=$(($(date +%s) - started))
}

hung_check engine-guard-webview-click

[ "$status" -ne 124 ] && [ "$took" -lt 30 ] &&
  ok "a check in the batch that never returns ends the group" ||
  fail "a check in the batch that never returns ends the group" \
    "status $status after ${took}s: $(cat "$WORK/out")"
grep -qE "^  engine-guard-webview-click +FAILED$" "$WORK/out" &&
  ok "and fails it" || fail "and fails it" "$(cat "$WORK/out")"
grep -q "ran past 2s" "$WORK/out" && grep -q "waiting on a browser" "$WORK/out" &&
  ok "saying it timed out, beside its own log" ||
  fail "saying it timed out, beside its own log" "$(cat "$WORK/out")"
# Dead or a zombie: a container whose init reaps nothing keeps the second.
child="$(cat "$WORK/child.pid" 2>/dev/null)"
[ -n "$child" ] && case "$(ps -o stat= -p "$child")" in (''|Z*) true ;; (*) false ;; esac &&
  ok "what it started is killed with it" ||
  fail "what it started is killed with it" "pid '$child' is alive"
sleep 1
[ -z "$(ls -A "$WORK/noise" 2>/dev/null)" ] &&
  ok "and it is no longer noise another run's latency guard waits on" ||
  fail "and it is no longer noise another run's latency guard waits on" \
    "$(cat "$WORK"/noise/*/owner 2>/dev/null)"

# Serial, outside the batch, and with no job name: the path a person runs.
rm -f "$WORK/child.pid"
HANG=engine-guard-shell PATH="$WORK/bin:$PATH" \
  DOMICILE_ENGINE_CHECK_TIMEOUT=2 DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
  timeout 60 "$WORK/repo/scripts/check.sh" engine >"$WORK/out" 2>&1
grep -qE "^  engine-guard-shell +FAILED$" "$WORK/out" &&
  ok "a serial check that never returns fails too, run by hand" ||
  fail "a serial check that never returns fails too, run by hand" "$(cat "$WORK/out")"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
