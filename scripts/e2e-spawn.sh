#!/usr/bin/env bash
# Reproducible check that a chrome `spawn` message launches a client process.
#   nix develop .#full -c ./scripts/e2e-spawn.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p dm-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-spawn"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"

RUST_LOG="info" "$BIN" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

node -e '
const net = require("net");
const c = net.connect(process.env.SOCK, () => {
  c.write(JSON.stringify({ type: "hello", protocol_version: 1 }) + "\n");
  c.write(JSON.stringify({ type: "spawn", command: ["true"] }) + "\n");
  setTimeout(() => process.exit(0), 500);
});
c.on("error", () => {});
'
for _ in $(seq 1 50); do grep -q "spawning client" "$LOG" && break; sleep 0.1; done

if grep -q "spawning client" "$LOG"; then
  echo "PASS: a chrome spawn message launched a client process"
  grep "spawning client" "$LOG" | head -1
else
  echo "FAIL: no spawn happened"; cat "$LOG"; exit 1
fi
