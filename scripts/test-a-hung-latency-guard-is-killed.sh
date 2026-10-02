#!/usr/bin/env bash
# The latency guard's measurement is timed like every other engine check.
#
# `check.sh` runs every engine check but latency under `timeout`, because
# latency's own wait for a quiet machine is meant to be long. What follows that
# wait was untimed: a measurement that never returned held a crux runner for
# the job's twelve hours and the card until another run stole it. So the timer
# starts once the card is taken, and covers the guard and its control alike.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'pkill -f "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

command -v timeout >/dev/null 2>&1 || { echo "SKIP: no timeout(1)"; exit 77; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# A repository holding the latency guard, the lock it takes and the library it
# runs through, with a stand-in for under-wayland.sh: a measurement that starts
# a child and then waits on a browser that never answers.
REPO="$WORK/repo"
mkdir -p "$REPO/scripts/lib" "$REPO/.github/scripts" \
  "$REPO/packages/domicile-engine/scripts" "$WORK/chromium/out/Domicile"
cp "$ROOT/scripts/engine-guard-latency.sh" "$REPO/scripts/"
cp "$ROOT/scripts/lib/engine-guard.sh" "$REPO/scripts/lib/"
cp "$ROOT/.github/scripts/engine-render-node-lock.sh" "$REPO/.github/scripts/"
cp "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh" \
  "$REPO/packages/domicile-engine/scripts/"
cat >"$REPO/packages/domicile-engine/scripts/under-wayland.sh" <<STUB
#!/usr/bin/env bash
echo "latency is waiting on a browser"
sh -c 'echo \$\$ >"$WORK/child.pid"; exec sleep 300 # $WORK' &
sleep 300
STUB
chmod +x "$REPO/packages/domicile-engine/scripts/under-wayland.sh"

started="$(date +%s)"
DOMICILE_CHROMIUM="$WORK/chromium" DOMICILE_ENGINE_CHECK_TIMEOUT=2 \
  DOMICILE_RENDER_NODE_LOCK="$WORK/card" DOMICILE_RENDER_NODE_NOISE="$WORK/noise" \
  CARD_OWNER=engine-run-9 \
  timeout 60 "$REPO/scripts/engine-guard-latency.sh" >"$WORK/out" 2>&1
status=$?
took=$(($(date +%s) - started))

[ "$status" -ne 0 ] && [ "$took" -lt 40 ] &&
  ok "a measurement that never returns fails the guard" ||
  fail "a measurement that never returns fails the guard" \
    "status $status after ${took}s: $(cat "$WORK/out")"
grep -q "ran past 2s" "$WORK/out" && grep -q "waiting on a browser" "$WORK/out" &&
  ok "saying it timed out, beside its own log" ||
  fail "saying it timed out, beside its own log" "$(cat "$WORK/out")"
# Dead or a zombie: a container whose init reaps nothing keeps the second.
child="$(cat "$WORK/child.pid" 2>/dev/null)"
[ -n "$child" ] && case "$(ps -o stat= -p "$child")" in (''|Z*) true ;; (*) false ;; esac &&
  ok "what it started is killed with it" ||
  fail "what it started is killed with it" "pid '$child' is alive"
[ ! -e "$WORK/card" ] &&
  ok "and the card is dropped for the next run" ||
  fail "and the card is dropped for the next run" "$(cat "$WORK/card/owner" 2>/dev/null)"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
