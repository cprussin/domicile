#!/usr/bin/env bash
# Checks the latency guard's measurement has a timeout.
#
# `check.sh` does not time the latency guard, because its wait for a quiet
# machine is meant to be long. The timer starts once the render node is taken
# and covers the guard and its control, so a hung measurement cannot hold a
# `crux` runner and the render node.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'pkill -f "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

command -v timeout >/dev/null 2>&1 || { echo "SKIP: no timeout(1)"; exit 77; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# A repo with the latency guard, its lock and its library. The
# under-wayland.sh stub starts a child and then hangs.
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
# Dead or a zombie: a container whose init reaps nothing leaves zombies.
child="$(cat "$WORK/child.pid" 2>/dev/null)"
[ -n "$child" ] && case "$(ps -o stat= -p "$child")" in (''|Z*) true ;; (*) false ;; esac &&
  ok "what it started is killed with it" ||
  fail "what it started is killed with it" "pid '$child' is alive"
[ ! -e "$WORK/card" ] &&
  ok "and the card is dropped for the next run" ||
  fail "and the card is dropped for the next run" "$(cat "$WORK/card/owner" 2>/dev/null)"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
