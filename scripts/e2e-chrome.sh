#!/usr/bin/env bash
# Reproducible end-to-end proof of Domicile's message plane:
#   real Wayland client -> compositor -> Host brain -> chrome
#
#   nix develop .#full -c ./scripts/e2e-chrome.sh
#
# Boots the compositor, connects a headless mock chrome, maps a real toplevel
# (weston-flower), and asserts the chrome receives app_appeared.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p domicile-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-e2e"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"
OUT="$(mktemp)"

"$BIN" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" "$MOCK" 2>/dev/null; rm -f "$OUT"' EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

DOMICILE_CHROME_SOCK="$SOCK" node "$ROOT/scripts/mock-chrome.cjs" >"$OUT" 2>&1 &
MOCK=$!
sleep 0.6
WAYLAND_DISPLAY=wayland-1 timeout 2 weston-flower >/dev/null 2>&1
sleep 0.4
kill -9 "$MOCK" 2>/dev/null

echo "== messages the chrome received =="
cat "$OUT"
if grep -q '"app_appeared"' "$OUT"; then
  echo "PASS: Wayland client -> compositor -> Host -> chrome"
else
  echo "FAIL"; exit 1
fi
