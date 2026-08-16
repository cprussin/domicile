#!/usr/bin/env bash
# A chrome that stops reading must not take the compositor down with it.
#
#   nix develop .#full -c ./scripts/e2e-slow-chrome.sh
#
# Frames are large — a 1753x1753 window is 16MB of base64 — so a chrome that
# reads slowly fills the socket buffer within a frame or two. If the compositor
# writes from its Wayland loop, that write blocks, frame callbacks stop, and
# every client freezes. The compositor must instead drop the frame: the next one
# supersedes it anyway.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p domicile-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-slow"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
COMPLOG="$(mktemp)"
STUCK=""; CLI=""

RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$BIN" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
disown "$COMP" 2>/dev/null || true
cleanup() { kill -9 "$COMP" $STUCK $CLI 2>/dev/null; rm -f "$COMPLOG"; }
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done
# Distinguish "the compositor never came up" from the freeze this check is for:
# both look like an unanswered client, and only one of them is a finding.
if ! { kill -0 "$COMP" 2>/dev/null && [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; }; then
  echo "ERROR: the compositor did not come up; nothing was tested."
  sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | tail -5
  exit 1
fi

# Any client that keeps drawing will do; this check is about the chrome side.
# nixpkgs builds weston with `simple-clients` off, so the full shell falls back
# to kitty, kept busy so it redraws.
if command -v weston-simple-shm >/dev/null 2>&1; then
  CLIENT=(weston-simple-shm)
elif command -v kitty >/dev/null 2>&1; then
  CLIENT=(kitty --config NONE -o confirm_os_window_close=0
          sh -c 'while :; do date; sleep 0.2; done')
else
  echo "SKIP: no continuously-drawing client on PATH (wanted weston-simple-shm or kitty)."
  exit 0
fi

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/stuck-chrome.ts" >/dev/null 2>&1 &
STUCK=$!
disown "$STUCK" 2>/dev/null || true
for _ in $(seq 1 100); do
  sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -aq "chrome client connected" && break
  sleep 0.05
done
if ! sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -aq "chrome client connected"; then
  echo "ERROR: the stuck chrome never connected; nothing was tested."; exit 1
fi

WAYLAND_DISPLAY=wayland-1 timeout 20 "${CLIENT[@]}" >/dev/null 2>&1 &
CLI=$!
disown "$CLI" 2>/dev/null || true
sleep 5

echo "== is the compositor still serving clients? =="
if WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info >/dev/null 2>&1; then
  echo "PASS: the compositor still answers with a chrome that reads nothing"
else
  echo "FAIL: the stuck chrome froze the compositor's event loop"; exit 1
fi

# Liveness alone is not enough: a compositor that answers but stopped importing
# has failed the client just as thoroughly.
frames=$(sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -ac "broadcast app frame")
echo "== frames the compositor kept producing =="
echo "produced: $frames  dropped: $(sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -ac 'dropped a frame')"
if [ "$frames" -ge 5 ]; then
  echo "PASS: it kept compositing ($frames frames) instead of stalling on the chrome"
else
  echo "FAIL: only $frames frame(s) — the chrome's backpressure reached the client path"; exit 1
fi
