#!/usr/bin/env bash
# Reproducible check that a chrome `spawn` message launches a client process.
#   nix develop .#full -c ./scripts/e2e-spawn.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# libwayland colours WAYLAND_DEBUG even into a file, and tracing colours its own
# output; the checks below read that output, and escapes land mid-field.
export NO_COLOR=1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-spawn"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"
# The probe writes the display its spawned child saw beside the chrome socket.
SPAWNED="$SOCK.display"
rm -f "$SPAWNED"

# A display that is not Domicile's, so "the child inherited ours" is a failure
# the check can see rather than a value that happens to look right. This is the
# session a presenting compositor would be a client of.
export WAYLAND_DISPLAY="not-domicile"

RUST_LOG="info" "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/spawn-probe.ts"
for _ in $(seq 1 50); do grep -q "spawning client" "$LOG" && break; sleep 0.1; done

if grep -q "spawning client" "$LOG"; then
  echo "PASS: a chrome spawn message launched a client process"
  grep "spawning client" "$LOG" | head -1
else
  echo "FAIL: no spawn happened"; cat "$LOG"; exit 1
fi

for _ in $(seq 1 50); do [ -s "$SPAWNED" ] && break; sleep 0.1; done
DOMICILE_DISPLAY="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
SPAWNED_DISPLAY="$(cat "$SPAWNED" 2>/dev/null || true)"
if [ -n "$DOMICILE_DISPLAY" ] && [ "$SPAWNED_DISPLAY" = "$DOMICILE_DISPLAY" ]; then
  echo "PASS: the spawned client was aimed at Domicile (WAYLAND_DISPLAY=$SPAWNED_DISPLAY)"
else
  echo "FAIL: the spawned client got WAYLAND_DISPLAY='$SPAWNED_DISPLAY', not"
  echo "  Domicile's '$DOMICILE_DISPLAY'. A client that inherits the"
  echo "  compositor's own display opens on the session the compositor is"
  echo "  presenting into — the host desktop — instead of inside Domicile."
  exit 1
fi
