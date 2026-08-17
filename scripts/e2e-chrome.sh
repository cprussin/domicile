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
CLIENT="$(mktemp)"

"$BIN" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" "$MOCK" 2>/dev/null; rm -f "$OUT" "$CLIENT"' EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$OUT" 2>&1 &
MOCK=$!
sleep 0.6
# WAYLAND_DEBUG logs every event the client receives, which is the only place
# a buffer release is visible — it produces no output of its own. NO_COLOR
# because libwayland otherwise writes SGR escapes *between* the interface name
# and the event (`wl_surface` ESC `#12` ESC `.enter`), and every check below
# reads the log as plain text — a coloured log matches nothing and passes
# nothing, which is a guard that silently guards.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 2 weston-flower >"$CLIENT" 2>&1
sleep 0.4
kill -9 "$MOCK" 2>/dev/null

echo "== messages the chrome received =="
cat "$OUT"
if grep -q '"app_appeared"' "$OUT"; then
  echo "PASS: Wayland client -> compositor -> Host -> chrome"
else
  echo "FAIL"; exit 1
fi

# A client may not touch a buffer again until the compositor releases it, so a
# compositor that never releases stalls any client that reuses one — the window
# freezes after its first frame. Smithay only releases the previous buffer when
# the next one is committed, which is exactly the buffer the client cannot draw.
# A client that scales its content asks which output it is on before it draws
# its first frame — GLFW-based ones (kitty) block on exactly this. A compositor
# that never sends `wl_surface.enter` leaves them mapped and blank forever.
echo "== the client was told which output it is on =="
grep -oE "wl_surface[#@][0-9]+\.enter" "$CLIENT" | head -1
if grep -qE "wl_surface[#@][0-9]+\.enter" "$CLIENT"; then
  echo "PASS: the client got wl_surface.enter"
else
  echo "FAIL: no wl_surface.enter — the client never learns its output or scale"; exit 1
fi

echo "== the client got its buffer back =="
grep -oE "wl_buffer[#@][0-9]+\.release" "$CLIENT" | head -1
if grep -qE "wl_buffer[#@][0-9]+\.release" "$CLIENT"; then
  echo "PASS: the compositor released the client's buffer"
else
  echo "FAIL: no wl_buffer.release — the client can never reuse that buffer"; exit 1
fi
