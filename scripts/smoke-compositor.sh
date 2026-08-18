#!/usr/bin/env bash
# Smoke test: boot the headless Domicile compositor and prove a real Wayland client
# (wayland-info) connects and binds the globals we advertise, then exits.
#
# Run inside the full shell:  nix develop .#full -c ./scripts/smoke-compositor.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK"; chmod 700 "$WORK"
trap 'kill -9 "$COMP" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" > "$WORK/compositor.log" 2>&1 &
COMP=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

echo "== globals a real client binds against domicile-compositor =="
WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null \
  | grep -oE "interface: '(wl_compositor|wl_shm|xdg_wm_base|wl_seat)'" | sort -u

got=$(WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null | grep -c "xdg_wm_base")
if [ "$got" -ge 1 ]; then echo "PASS: client bound xdg_wm_base (+ others above)"; else echo "FAIL"; exit 1; fi
