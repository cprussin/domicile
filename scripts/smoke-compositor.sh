#!/usr/bin/env bash
# Smoke test: boots the headless compositor and checks that wayland-info sees
# the globals clients need.
#
# Run inside the full shell:  nix develop .#full -c ./scripts/smoke-compositor.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Always build: a stale binary would test code that is not in the tree.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}

# Skip (77) without wayland-info; otherwise every global would read as missing.
command -v wayland-info >/dev/null 2>&1 || {
  echo "SKIP: no wayland-info, which is what asks the compositor what it advertises."
  exit 77
}

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK"; chmod 700 "$WORK"
trap 'kill -9 "$COMP" 2>/dev/null; rm -rf "$WORK"' EXIT

# Nothing connects to the chrome socket, but the compositor requires the path.
SOCK="$WORK/chrome.sock"
"$BIN" --chrome-socket "$SOCK" --session "$WORK/session.json" \
  > "$WORK/compositor.log" 2>&1 &
COMP=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

echo "== globals a real client binds against domicile-compositor =="
ADVERTISED="$(WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null)"
echo "$ADVERTISED" \
  | grep -oE "interface: '(wl_compositor|wl_shm|xdg_wm_base|wl_seat|wl_data_device_manager)'" \
  | sort -u

# Clients do not report a missing global. Without `wl_data_device_manager`,
# for example, the engine hangs on a tab drag: it runs a nested loop until the
# drag completes, and nothing completes it.
for global in wl_compositor wl_shm xdg_wm_base wl_seat wl_data_device_manager; do
  if ! echo "$ADVERTISED" | grep -q "interface: '$global'"; then
    echo "FAIL: $global is not advertised. A client that wants it will not say"
    echo "  so — it will wait, or quietly do without."
    exit 1
  fi
done
echo "PASS: every global a desktop's clients expect is advertised"

# Chromium needs these for delegated compositing (a subsurface per quad).
# Without them it only logs `Server doesn't support <name>` and falls back.
# See `docs/architecture/WINDOW-COMPOSITING.md`.
for global in wp_viewporter wp_single_pixel_buffer_manager_v1 wp_content_type_manager_v1; do
  if ! echo "$ADVERTISED" | grep -q "interface: '$global'"; then
    echo "FAIL: $global is not advertised, so a chrome that wanted it has"
    echo "  quietly gone without — which is what delegated compositing does."
    exit 1
  fi
done
echo "PASS: the standard protocols delegated compositing asks for are advertised"
