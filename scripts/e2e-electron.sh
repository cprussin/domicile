#!/usr/bin/env bash
# Reproducible proof of the full GUI path, headlessly (Electron under Xvfb):
#   Wayland client -> compositor -> host -> Electron chrome -> <loom-app> mounted
#   -> geometry reported back (place_portal).
#
#   nix develop .#full -c ./scripts/e2e-electron.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/loom-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p wc-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/loom-rt-xvfb"      # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/loom-chrome.sock
SOCK="$XDG_RUNTIME_DIR/loom-chrome.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"

# Wait until $2 appears in file $1 (or time out). $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

RUST_LOG="info,loom_compositor=debug" "$BIN" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" "$EL" "$XVFB" "$FLOWER" 2>/dev/null; pkill -9 -f "shells/simple" 2>/dev/null; rm -f "$LOG" "$ELOG"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

# Headless X for Electron.
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
export DISPLAY=:99
sleep 0.8

LOOM_CHROME_SOCKET="$SOCK" electron --no-sandbox --disable-gpu --disable-dev-shm-usage "$ROOT/shells/simple" >"$ELOG" 2>&1 &
EL=$!

# 1) Wait for the Electron *renderer* to be up (it sends hello after loading).
if ! wait_for "$LOG" '"type":"hello"' 200; then echo "FAIL: Electron renderer never handshook"; exit 1; fi
echo "OK: Electron renderer connected and handshook"

# 2) Map a real Wayland client and wait until the compositor sees the toplevel.
WAYLAND_DISPLAY=wayland-1 weston-flower >/dev/null 2>&1 &
FLOWER=$!
if ! wait_for "$LOG" "toplevel mapped" 50; then echo "FAIL: client never mapped a toplevel"; exit 1; fi
echo "OK: Wayland client mapped a toplevel (Host::app_appeared)"

# 3) The chrome should mount <loom-app> and report its placement back.
if wait_for "$LOG" "place_portal" 50; then
  echo "PASS: Electron chrome mounted <loom-app> for the live client and reported a portal"
else
  echo "FAIL: chrome did not report a portal"; exit 1
fi
