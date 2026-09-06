#!/usr/bin/env bash
# Run another spike script under a nested Wayland compositor, on the GPU.
#
#   NIX_SHELL_RUN=".../scripts/spike-wayland.sh /build/chromium/src \
#     ./scripts/spike-step4.sh" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# WHY THIS EXISTS. `--ozone-platform=headless` cannot import a dmabuf:
# HeadlessSurfaceFactory::CreateNativePixmap returns a stub TestPixmap and
# CreateNativePixmapFromHandle is not implemented at all, so there is nothing
# for an imported buffer to become. Only the drm, wayland, x11 and flatland
# platforms implement it. Wayland is the cheap one — the build already sets
# ozone_platform_wayland — and this is the compositor to nest under.
#
# WHY NOT WESTON, which is in the full dev shell. Weston's headless backend
# advertises wl_shm and nothing else; measured on crux, its globals contain no
# zwp_linux_dmabuf_v1. Chromium's WaylandBufferManagerGpu::GetGbmDevice()
# returns null unless the host supports dmabuf, so under weston the GBM device
# is never created and native pixmaps stay unsupported. A wlroots compositor's
# headless backend does advertise it, because it builds a renderer on the
# render node whether or not anything is on screen.
#
# WHAT THIS PROVED ON CRUX. Under sway, Chromium binds zwp_linux_dmabuf_v1,
# picks /dev/dri/renderD128 ("picking nvidia-drm"), and creates its GBM device
# on it — the NVIDIA proprietary driver ships nvidia-drm_gbm.so and its EGL
# advertises EGL_EXT_image_dma_buf_import. Chromium's GBM path does not require
# Mesa.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-wayland.sh <path to chromium/src> <script> [args...]" >&2
  exit 1
fi
shift

if [ $# -eq 0 ]; then
  echo "usage: spike-wayland.sh <path to chromium/src> <script> [args...]" >&2
  exit 1
fi

# An already-running compositor is used as-is, which is what a machine with a
# session wants. Otherwise one is brought up for the run.
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

export XDG_RUNTIME_DIR="${SPIKE_RUNTIME_DIR:-/tmp/domicile-spike-wl-rt}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# A compositor that was killed leaves its socket behind, and the wait below
# takes the first one it finds — which would be the dead one, and every client
# then fails with "Connection refused" against a compositor that is running
# perfectly well next to it.
rm -f "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null || true
# The virtual output has to be bigger than the largest page any check drives,
# or the compositor clamps the window and the page does not fit. wlroots'
# headless output defaults to 1280x720, which is smaller than step 4's grid.
OUTPUT_MODE="${OUTPUT_MODE:-1600x1200@60Hz}"
CONFIG="$(mktemp)"
# No borders and no gaps: the measurement finds the page by looking for the
# first row of the window that is the page's background all the way across, and
# a tiling compositor's border puts a pixel of its own at each end of every row.
cat > "$CONFIG" <<CONFIG_EOF
output HEADLESS-1 mode $OUTPUT_MODE
default_border none
default_floating_border none
gaps inner 0
gaps outer 0
CONFIG_EOF

# wlroots' headless backend needs to be told which render node to build its
# renderer on; without it, it picks the first card and on a machine whose only
# GPU is behind nvidia-drm that is the wrong answer often enough to be worth
# pinning.
nix shell nixpkgs#sway --command env \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  WLR_BACKENDS=headless \
  WLR_LIBINPUT_NO_DEVICES=1 \
  WLR_RENDER_DRM_DEVICE="${RENDER_NODE:-/dev/dri/renderD128}" \
  sway -c "$CONFIG" >/tmp/domicile-spike-wayland.log 2>&1 &
COMPOSITOR=$!
cleanup() {
  kill "$COMPOSITOR" 2>/dev/null
  wait "$COMPOSITOR" 2>/dev/null
  rm -f "$CONFIG"
}
trap cleanup EXIT

# Fetching sway from the binary cache on a cold machine is slower than starting
# it, so this waits generously.
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
  echo "no compositor came up; see /tmp/domicile-spike-wayland.log" >&2
  exit 1
fi
echo "nested compositor on $WAYLAND_DISPLAY"

OZONE=wayland GPU=1 "$@"
