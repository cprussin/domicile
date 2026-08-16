#!/usr/bin/env bash
# Launch the Loom prototype: the headless Wayland compositor + the Electron
# chrome window. Then launch a Wayland app INTO Loom and watch it appear in the
# chrome.
#
#   nix develop .#full -c ./scripts/run-prototype.sh
#
# In another terminal, put an app on Loom's display:
#   XDG_RUNTIME_DIR=/tmp/loom-rt WAYLAND_DISPLAY=wayland-1 weston-flower
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Loom's own runtime dir (kept short for Unix-socket limits, and separate from
# your real session so its wayland-1 doesn't clash with your desktop).
LOOM_RT="/tmp/loom-rt"
mkdir -p "$LOOM_RT"; chmod 700 "$LOOM_RT"
rm -f "$LOOM_RT"/wayland-* "$LOOM_RT"/loom-chrome.sock
CHROME_SOCK="$LOOM_RT/loom-chrome.sock"

echo "loom: building compositor..."
( cd "$ROOT" && cargo build -p wc-compositor ) || { echo "build failed"; exit 1; }

echo "loom: starting headless Wayland compositor..."
XDG_RUNTIME_DIR="$LOOM_RT" "$ROOT/target/debug/loom-compositor" --chrome-socket "$CHROME_SOCK" &
COMP=$!
trap 'kill "$COMP" "$CHROME" 2>/dev/null' EXIT

for _ in $(seq 1 200); do [ -S "$CHROME_SOCK" ] && break; sleep 0.05; done
[ -S "$CHROME_SOCK" ] || { echo "compositor did not come up"; exit 1; }

echo "loom: starting Electron chrome window..."
# Electron runs in YOUR session (uses your display); it only needs the socket.
LOOM_CHROME_SOCKET="$CHROME_SOCK" electron --no-sandbox "$ROOT/shells/simple" &
CHROME=$!

cat <<EOF

  Loom is running.
    - The Electron window IS the chrome (a web page).
    - Loom's Wayland display is 'wayland-1' under XDG_RUNTIME_DIR=$LOOM_RT

  Put an app onto Loom (in another terminal, inside 'nix develop .#full'):

    XDG_RUNTIME_DIR=$LOOM_RT WAYLAND_DISPLAY=wayland-1 weston-flower

  A styled <app> portal should appear in the chrome window. Close the window
  (or Ctrl-C here) to stop.

EOF

wait "$CHROME" 2>/dev/null
