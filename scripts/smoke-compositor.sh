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

# `wayland-info` is the client this asks its one question through. Without it
# every global reads as unadvertised, which is a verdict against the compositor
# for a program that was never installed — so this says it did not run (77)
# rather than that the compositor failed.
command -v wayland-info >/dev/null 2>&1 || {
  echo "SKIP: no wayland-info, which is what asks the compositor what it advertises."
  exit 77
}

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK"; chmod 700 "$WORK"
trap 'kill -9 "$COMP" 2>/dev/null; rm -rf "$WORK"' EXIT

# No chrome: this asks one question — do our globals reach a real client — and
# nothing here connects to the chrome socket. It is still named, because the
# compositor names every path rather than guessing any.
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

# Each of these, by name. A global a toolkit expects and does not find is not an
# error it reports — `wl_data_device_manager` was missing for months and showed
# up as the chrome freezing whenever a tab was dragged, because the engine runs
# a nested loop until a drag completes and nothing could complete it.
for global in wl_compositor wl_shm xdg_wm_base wl_seat wl_data_device_manager; do
  if ! echo "$ADVERTISED" | grep -q "interface: '$global'"; then
    echo "FAIL: $global is not advertised. A client that wants it will not say"
    echo "  so — it will wait, or quietly do without."
    exit 1
  fi
done
echo "PASS: every global a desktop's clients expect is advertised"

# And the ones on the way to delegated compositing. Chromium asks for these
# before it will send its layer tree as a subsurface per quad, and says so in
# its own log — `Server doesn't support <name>` — rather than failing. Losing
# one here is losing that, silently and much later. See
# `docs/architecture/WINDOW-COMPOSITING.md`.
for global in wp_single_pixel_buffer_manager_v1 wp_content_type_manager_v1; do
  if ! echo "$ADVERTISED" | grep -q "interface: '$global'"; then
    echo "FAIL: $global is not advertised, so a chrome that wanted it has"
    echo "  quietly gone without — which is what delegated compositing does."
    exit 1
  fi
done
echo "PASS: the standard protocols delegated compositing asks for are advertised"

# And the one that must *not* be, which is the same list read the other way.
# A global is a promise to honour what a client then says through it, and
# Chromium takes `wp_viewporter` as permission to stop calling
# `wl_surface.set_buffer_scale` and put its logical size in
# `wp_viewport.set_destination` instead. The commit path reads the buffer and
# its scale and nothing else, so advertising this made every surface on a 2x
# display twice its true size: the desktop drawn at double, and every portal
# and pointer coordinate out by the same factor. At 1x the two forms agree,
# which is why this is asserted here rather than left to a check that draws.
#
# The row moves back up to the loop above when the commit path honours a
# destination — not when the global goes back, which is the order that broke
# it.
if echo "$ADVERTISED" | grep -q "interface: 'wp_viewporter'"; then
  echo "FAIL: wp_viewporter is advertised. Unless the commit path now takes a"
  echo "  surface's logical size from its viewport destination, this doubles"
  echo "  the whole desktop on every display denser than 1x."
  exit 1
fi
echo "PASS: no wp_viewporter, which is a promise this compositor cannot keep"
