#!/usr/bin/env bash
# Prove forwarded input reaches a real client, keyboard AND pointer. Runs
# `weston-eventdemo` on Domicile with WAYLAND_DEBUG so we can see the exact protocol
# events it receives, and forwards a focus+pointer+key sequence via the chrome
# protocol.
#   nix develop .#full -c ./scripts/e2e-input.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p domicile-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-input"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
APP="$(mktemp)"
CHROME="$(mktemp)"

"$BIN" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" "$INJ" "$CLI" 2>/dev/null; rm -f "$APP" "$CHROME"; }
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# Connect the injector first so it's subscribed before the app appears.
DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/input-injector.ts" >"$CHROME" 2>&1 &
INJ=$!
sleep 0.5

# WAYLAND_DEBUG makes the client log every protocol event it receives. It names
# objects `wl_keyboard@14` on current libwayland and `wl_keyboard#14` on older
# releases, so the greps below accept either.
WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 6 weston-eventdemo >"$APP" 2>&1 &
CLI=$!
# Wait for a real key event: `.key(` and not `.keymap`, which arrives at once
# and would end the wait before any input had been forwarded.
for _ in $(seq 1 60); do grep -qE "wl_keyboard[#@][0-9]+\.key\(" "$APP" && break; sleep 0.1; done

echo "== input events the client received =="
grep -oE "wl_(pointer|keyboard)[#@][0-9]+\.(enter|motion|button|key)\([^)]*\)" "$APP" | head
key_ok=$(grep -cE "wl_keyboard[#@][0-9]+\.key\(" "$APP")
btn_ok=$(grep -cE "wl_pointer[#@][0-9]+\.button\(" "$APP")
if [ "$key_ok" -ge 1 ] && [ "$btn_ok" -ge 1 ]; then
  echo "PASS: forwarded keyboard + pointer input reached the client"
else
  echo "FAIL: keyboard=$key_ok pointer_button=$btn_ok"; exit 1
fi

# The pointer entering a surface makes the client ask for a cursor, which the
# host hands back to the chrome as a CSS keyword for that app's element.
echo "== cursor the client asked the chrome for =="
grep -m1 '"app_cursor"' "$CHROME"
if grep -q '"app_cursor"' "$CHROME"; then
  echo "PASS: the client's cursor request reached the chrome"
else
  echo "FAIL: no app_cursor reached the chrome"; exit 1
fi
