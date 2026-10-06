#!/usr/bin/env bash
# Checks a window reaches a PipeWire consumer as video, and that the cast ends
# when the consumer leaves.
#
#   nix develop .#full -c ./scripts/e2e-a-window-casts-to-pipewire.sh
#
# Starts its own headless `pipewire` daemon, with no session manager, so the
# check links the consumer with `pw-link`. `DOMICILE_CAST_WINDOW` starts the
# cast; the ScreenCast portal is not involved. The test client draws shm, so
# the frames are shm too: dmabuf casts need a render node (see
# `e2e-dmabuf.sh`).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"

for tool in pipewire pw-link; do
  command -v "$tool" >/dev/null || {
    echo "SKIP: no $tool here; run inside nix develop .#full, or install pipewire"
    exit 77
  }
done

BIN="$ROOT/target/debug/domicile-compositor"
READER="$ROOT/target/debug/domicile-test-cast-reader"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
[ -x "$READER" ] || { echo "no cast reader at $READER after building"; exit 1; }
build_test_client || exit 1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-cast"   # short: Unix socket path limit
rm -rf "$XDG_RUNTIME_DIR"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; PWLOG="$(mktemp)"; FRAMES="$(mktemp)"; RLOG="$(mktemp)"
PW=""; COMP=""; CLIENT=""; READING=""
# TERM, not KILL: bash prints "Killed" when reaping a SIGKILLed child.
cleanup() {
  kill $READING $CLIENT $COMP $PW 2>/dev/null; wait 2>/dev/null
  rm -f "$LOG" "$PWLOG" "$FRAMES" "$RLOG"; rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT

pipewire >"$PWLOG" 2>&1 &
PW=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/pipewire-0" ] && break; sleep 0.05; done
# Exit 1: there is no compositor yet for a harness helper to check, and a
# pipewire that will not start leaves nothing to cast to.
[ -S "$XDG_RUNTIME_DIR/pipewire-0" ] || {
  echo "ERROR: pipewire made no socket; it said:"; tail -20 "$PWLOG"; exit 1
}

TITLE="cast-me"
NO_COLOR=1 DOMICILE_CAST_WINDOW="$TITLE" RUST_LOG=info,domicile_compositor=debug \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done
WAYLAND_DISPLAY=wayland-1 "$TEST_CLIENT" --title "$TITLE" >/dev/null 2>&1 &
CLIENT=$!

for _ in $(seq 1 200); do grep -q "cast ready" "$LOG" && break; sleep 0.05; done
NODE="$(sed -n 's/.*cast ready.* node=\([0-9]*\).*/\1/p' "$LOG" | head -1)"
if [ -n "$NODE" ]; then
  passed "the window's cast is PipeWire node $NODE"
else
  compositor_verdict "$COMP" \
    "FAIL: the compositor never said its cast of \"$TITLE\" was ready." \
    "  The cast starts when the window takes that title. Its log:" \
    "$(grep -E "cast|PipeWire" "$LOG" | tail -10)"
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

for _ in $(seq 1 100); do grep -q "cast ended.*ConsumerLeft" "$LOG" && break; sleep 0.05; done
if ! after 2; then
  harness_fault "$COMP" "frames were read" "ERROR: no frames to stop reading."
elif grep -q "cast ended.*ConsumerLeft" "$LOG"; then
  passed "the cast ended when its consumer left"
else
  compositor_verdict "$COMP" \
    "FAIL: the consumer left and the cast did not end. The compositor said:" \
    "$(grep -E "cast" "$LOG" | tail -10)"
fi

every_check_ran 3
