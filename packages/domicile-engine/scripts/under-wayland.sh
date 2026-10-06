#!/usr/bin/env bash
# Runs a script under a nested Wayland compositor, on the GPU.
#
#   NIX_SHELL_RUN=".../scripts/under-wayland.sh /build/chromium/src \
#     ./scripts/guard-css-and-resize.sh" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# `--ozone-platform=headless` cannot import a dmabuf:
# HeadlessSurfaceFactory does not implement CreateNativePixmapFromHandle. Of
# the platforms that do (drm, wayland, x11, flatland), wayland is already
# enabled in the build.
#
# Uses sway, not weston. Weston's headless backend advertises only wl_shm, not
# zwp_linux_dmabuf_v1, so Chromium's WaylandBufferManagerGpu::GetGbmDevice()
# returns null. wlroots' headless backend still builds a renderer on the render
# node and advertises dmabuf. On crux's NVIDIA proprietary driver, Chromium
# creates its GBM device on /dev/dri/renderD128 without Mesa.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-compositor-cleanup.sh
. "$SCRIPTS/lib-compositor-cleanup.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: under-wayland.sh <path to chromium/src> <script> [args...]" >&2
  exit 1
fi
shift

if [ $# -eq 0 ]; then
  echo "usage: under-wayland.sh <path to chromium/src> <script> [args...]" >&2
  exit 1
fi

# Use an existing compositor if there is one; otherwise start one.
if [ -n "${WAYLAND_DISPLAY:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] &&
   [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
  echo "using the compositor already on $WAYLAND_DISPLAY"
  OZONE=wayland GPU=1 "$@"
  exit $?
fi

command -v nix >/dev/null || {
  echo "no compositor on WAYLAND_DISPLAY, and no nix to fetch one" >&2
  exit 1
}

export XDG_RUNTIME_DIR="${UNDER_WAYLAND_RUNTIME_DIR:-/tmp/domicile-under-wayland-rt}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# Collect compositors from runs that were killed before their trap ran (e.g.
# `timeout-minutes` or a canceled job).
kill_compositors
# Remove stale sockets: the wait below takes the first socket it finds, and a
# dead one makes every client fail with "Connection refused".
rm -f "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null || true
# The output must fit the largest page any check uses, or the compositor
# clamps the window. wlroots' default of 1280x720 is smaller than step 4's grid.
OUTPUT_MODE="${OUTPUT_MODE:-1600x1200@60Hz}"
CONFIG="$(mktemp)"
# No borders or gaps: the measurement finds the page by the first row that is
# the page's background edge to edge, and a border adds a pixel at each end.
cat > "$CONFIG" <<CONFIG_EOF
output HEADLESS-1 mode $OUTPUT_MODE
default_border none
default_floating_border none
gaps inner 0
gaps outer 0
CONFIG_EOF

# WLR_RENDER_DRM_DEVICE pins the render node; wlroots otherwise picks the
# first card, which is often wrong when the GPU is behind nvidia-drm.
# `nixpkgs#dbus` provides `dbus-daemon`: nixpkgs' sway wrapper runs
# `dbus-run-session`, which finds `dbus-daemon` on PATH. Under a systemd
# service (CI) there is none, and sway never starts.
nix shell nixpkgs#sway nixpkgs#dbus --command env \
  "$(compositor_env)" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  WLR_BACKENDS=headless \
  WLR_LIBINPUT_NO_DEVICES=1 \
  WLR_RENDER_DRM_DEVICE="${RENDER_NODE:-/dev/dri/renderD128}" \
  sway -c "$CONFIG" >/tmp/domicile-under-wayland.log 2>&1 &
COMPOSITOR=$!
cleanup() {
  # Not `kill "$COMPOSITOR"`: that pid is dbus-run-session, and killing it
  # orphans the bus, sway and swaybg. Kill by this run's owner marker instead,
  # so concurrent runs are spared. See lib-compositor-cleanup.sh.
  kill_compositors "$(compositor_owner)"
  wait "$COMPOSITOR" 2>/dev/null
  rm -f "$CONFIG"
}
trap cleanup EXIT

# Long timeout: on a cold machine, fetching sway takes longer than starting it.
for _ in $(seq 1 240); do
  for candidate in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$candidate" in
      *.lock) continue ;;
    esac
    if [ -S "$candidate" ]; then
      WAYLAND_DISPLAY="$(basename "$candidate")"
      export WAYLAND_DISPLAY
      break 2
    fi
  done
  sleep 1
done

if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "no compositor came up; see /tmp/domicile-under-wayland.log" >&2
  exit 1
fi
echo "nested compositor on $WAYLAND_DISPLAY"

OZONE=wayland GPU=1 "$@"
