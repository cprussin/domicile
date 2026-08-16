#!/usr/bin/env bash
# Smoke test: boot the headless Loom compositor and prove a real Wayland client
# (wayland-info) connects and binds the globals we advertise, then exits.
#
# Run inside the full shell:  nix develop .#full -c ./scripts/smoke-compositor.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/loom-compositor"
[ -x "$BIN" ] || { echo "build first: cargo build -p wc-compositor"; exit 1; }

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK"; chmod 700 "$WORK"
trap 'kill -9 "$COMP" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" > "$WORK/compositor.log" 2>&1 &
COMP=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

echo "== globals a real client binds against loom-compositor =="
WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null \
  | grep -oE "interface: '(wl_compositor|wl_shm|xdg_wm_base|wl_seat)'" | sort -u

got=$(WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null | grep -c "xdg_wm_base")
if [ "$got" -ge 1 ]; then echo "PASS: client bound xdg_wm_base (+ others above)"; else echo "FAIL"; exit 1; fi
