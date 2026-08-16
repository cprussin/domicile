#!/usr/bin/env bash
# Launch the Domicile prototype: the headless Wayland compositor + the Electron
# chrome window. Then launch a Wayland app INTO Domicile and watch it appear in the
# chrome.
#
#   nix develop .#full -c ./scripts/run-prototype.sh
#
# In another terminal, put an app on Domicile's display:
#   XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Domicile's own runtime dir (kept short for Unix-socket limits, and separate from
# your real session so its wayland-1 doesn't clash with your desktop).
DOMICILE_RT="/tmp/domicile-rt"
mkdir -p "$DOMICILE_RT"; chmod 700 "$DOMICILE_RT"
rm -f "$DOMICILE_RT"/wayland-* "$DOMICILE_RT"/domicile-chrome.sock
CHROME_SOCK="$DOMICILE_RT/domicile-chrome.sock"

echo "domicile: building compositor..."
( cd "$ROOT" && cargo build -p domicile-compositor ) || { echo "build failed"; exit 1; }

echo "domicile: starting headless Wayland compositor..."
XDG_RUNTIME_DIR="$DOMICILE_RT" "$ROOT/target/debug/domicile-compositor" --chrome-socket "$CHROME_SOCK" &
COMP=$!
trap 'kill "$COMP" "$CHROME" 2>/dev/null' EXIT

for _ in $(seq 1 200); do [ -S "$CHROME_SOCK" ] && break; sleep 0.05; done
[ -S "$CHROME_SOCK" ] || { echo "compositor did not come up"; exit 1; }

echo "domicile: starting Electron chrome window..."
# Electron runs in YOUR session (uses your display); it only needs the socket.
DOMICILE_CHROME_SOCKET="$CHROME_SOCK" electron --no-sandbox "$ROOT/shells/simple" &
CHROME=$!

cat <<EOF

  Domicile is running.
    - The Electron window IS the chrome (a web page).
    - Domicile's Wayland display is 'wayland-1' under XDG_RUNTIME_DIR=$DOMICILE_RT

  Put an app onto Domicile (in another terminal, inside 'nix develop .#full'):

    XDG_RUNTIME_DIR=$DOMICILE_RT WAYLAND_DISPLAY=wayland-1 weston-flower

  A styled <app> portal should appear in the chrome window. Close the window
  (or Ctrl-C here) to stop.

EOF

wait "$CHROME" 2>/dev/null
