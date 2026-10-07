#!/usr/bin/env bash
# Checks the ScreenCast portal casts a window an application picks, restores
# it from a token, and stops when the session closes.
#
#   nix develop .#full -c ./scripts/e2e-a-screen-cast-through-the-portal.sh
#
# Starts its own session bus and headless `pipewire`, with no session manager,
# so the check links the consumer with `pw-link`. `domicile-test-screencast`
# calls the backend on the bus as an application's portal frontend would, and
# answers the source picker as the shell. The test client draws shm, so the
# frames are shm too.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"

for tool in pipewire pw-link dbus-daemon; do
  command -v "$tool" >/dev/null || {
    echo "SKIP: no $tool here; run inside nix develop .#full, or install pipewire and dbus"
    exit 77
  }
done

BIN="$ROOT/target/debug/domicile-compositor"
READER="$ROOT/target/debug/domicile-test-cast-reader"
APP="$ROOT/target/debug/domicile-test-screencast"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
for built in "$BIN" "$READER" "$APP"; do
  [ -x "$built" ] || { echo "no $built after building"; exit 1; }
done
build_test_client || exit 1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-portal-cast"   # short: Unix socket path limit
rm -rf "$XDG_RUNTIME_DIR"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
# Restore tokens go here, not to the user's state.
export XDG_STATE_HOME="$XDG_RUNTIME_DIR/state"
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; PWLOG="$(mktemp)"; FRAMES="$(mktemp)"; RLOG="$(mktemp)"
SAID="$(mktemp)"; ALOG="$(mktemp)"; GO="$XDG_RUNTIME_DIR/go"
BUS=""; PW=""; COMP=""; CLIENT=""; READING=""; ASKING=""
# TERM, not KILL: bash prints "Killed" when reaping a SIGKILLed child.
cleanup() {
  exec 3>&- 2>/dev/null
  kill $ASKING $READING $CLIENT $COMP $PW $BUS 2>/dev/null; wait 2>/dev/null
  rm -f "$LOG" "$PWLOG" "$FRAMES" "$RLOG" "$SAID" "$ALOG"; rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT

dbus-daemon --session --nofork --nopidfile --address="$DBUS_SESSION_BUS_ADDRESS" >/dev/null 2>&1 &
BUS=$!
pipewire >"$PWLOG" 2>&1 &
PW=$!
for _ in $(seq 1 100); do
  [ -S "$XDG_RUNTIME_DIR/pipewire-0" ] && [ -S "$XDG_RUNTIME_DIR/bus" ] && break; sleep 0.05
done
# Exit 1: there is no compositor yet for a harness helper to check, and
# without a bus or pipewire there is nothing to cast through.
[ -S "$XDG_RUNTIME_DIR/bus" ] || { echo "ERROR: dbus-daemon made no socket"; exit 1; }
[ -S "$XDG_RUNTIME_DIR/pipewire-0" ] || {
  echo "ERROR: pipewire made no socket; it said:"; tail -20 "$PWLOG"; exit 1
}

TITLE="cast-me"
NO_COLOR=1 RUST_LOG=info,domicile_compositor=debug \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done
WAYLAND_DISPLAY=wayland-1 "$TEST_CLIENT" --title "$TITLE" >/dev/null 2>&1 &
CLIENT=$!
for _ in $(seq 1 200); do
  grep -q "answers the desktop portal" "$LOG" && grep -q "toplevel mapped" "$LOG" && break
  sleep 0.05
done

mkfifo "$GO"
"$APP" "$SOCK" "$TITLE" <"$GO" >"$SAID" 2>"$ALOG" &
ASKING=$!
exec 3>"$GO"

for _ in $(seq 1 200); do grep -q "^capturing" "$SAID" && break; sleep 0.05; done
NODE="$(sed -n 's/^node \([0-9]*\)$/\1/p' "$SAID")"
if [ -n "$NODE" ] && grep -q "^capturing" "$SAID"; then
  passed "the picked window is PipeWire node $NODE, and the shell lists the capture"
else
  compositor_verdict "$COMP" \
    "FAIL: the portal never cast the window the picker chose. The application said:" \
    "$(cat "$SAID" "$ALOG")" \
    "  The compositor said:" "$(grep -E "cast|portal" "$LOG" | tail -10)"
fi

timeout 20 "$READER" 3 >"$FRAMES" 2>"$RLOG" &
READING=$!
for _ in $(seq 1 100); do
  pw-link -i 2>/dev/null | grep -q "domicile-test-cast-reader:" && break; sleep 0.05
done
pw-link "domicile-cast:capture_1" "domicile-test-cast-reader:input_1" 2>&1
wait "$READING"; READ=$?; READING=""

# The client alternates between two colors; `frame WxH B G R X` per frame.
COLORS="80 48 32|128 80 48"
if ! after 1; then
  harness_fault "$COMP" "the cast was ready to read" "ERROR: no node to read."
elif [ "$READ" -ne 0 ]; then
  compositor_verdict "$COMP" \
    "FAIL: the consumer read $(wc -l <"$FRAMES") of 3 frames (exit $READ)." \
    "  It said:" "$(tail -5 "$RLOG")" \
    "  The compositor said:" "$(grep -E "cast" "$LOG" | tail -10)"
elif [ "$(grep -cE "^frame 320x240 ($COLORS) " "$FRAMES")" -eq 3 ]; then
  passed "three 320x240 frames arrived in the window's colors"
else
  compositor_verdict "$COMP" \
    "FAIL: frames arrived, but not the window's 320x240 in its colors:" \
    "$(cat "$FRAMES")"
fi

echo go >&3
for _ in $(seq 1 200); do grep -q "^closed" "$SAID" && break; sleep 0.05; done
if ! after 2; then
  harness_fault "$COMP" "frames were read" "ERROR: no frames to stop reading."
elif ! grep -q "^ended" "$SAID"; then
  compositor_verdict "$COMP" \
    "FAIL: the consumer left and the capture stayed listed. The application said:" \
    "$(cat "$SAID" "$ALOG")" "  The compositor said:" "$(grep -E "cast" "$LOG" | tail -10)"
elif ! grep -q "^restored node" "$SAID"; then
  compositor_verdict "$COMP" \
    "FAIL: the restore token did not cast the window again. The application said:" \
    "$(cat "$SAID" "$ALOG")" "  The compositor said:" "$(grep -E "cast|portal" "$LOG" | tail -10)"
elif grep -q "^closed" "$SAID" && grep -q "screen cast stream ended.*Stopped" "$LOG"; then
  passed "a restored cast started without the picker, and closing its session stopped it"
else
  compositor_verdict "$COMP" \
    "FAIL: closing the session did not stop its stream. The application said:" \
    "$(cat "$SAID" "$ALOG")" "  The compositor said:" "$(grep -E "cast" "$LOG" | tail -10)"
fi

every_check_ran 3
