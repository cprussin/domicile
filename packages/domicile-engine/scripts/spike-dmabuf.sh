#!/usr/bin/env bash
# Checks that a real dmabuf reaches the screen through a page. Results:
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#dmabuf-import.
#
#   NIX_SHELL_RUN=".../scripts/under-wayland.sh /build/chromium/src \
#     .../scripts/spike-dmabuf.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Must run under under-wayland.sh: --ozone-platform=headless has no
# CreateNativePixmapFromHandle, so the import fails.
#
# domicile_engine_dmabuf_smoke allocates two buffers on the render node, passes
# their fds to libdomicile_engine.so and submits both. It then reads the pixel
# at the window's center, where spike-page.html puts the <app>. It exits 0
# only if that pixel came from the buffer and `released` fired for the first
# buffer. The compositor must not reuse a buffer viz still holds, and viz
# holds whatever is on screen, so seeing a release takes two submits.
#
# Buffers are GPU-renderable by default. NVIDIA's gbm refuses
# `rendering|linear`, and a linear buffer imports but draws as the embedder's
# fallback. Real clients render into tiled buffers too. Without a GL context
# this cannot write known content, so the check is "the buffer's zeroed
# content, not the fallback" rather than an exact color. LINEAR=1 tries a
# CPU-writable buffer and fails on NVIDIA.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-dmabuf.sh <path to chromium/src> [producer flags]" >&2
  exit 1
fi
shift

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

# Distinct from the page background and anything else the spike draws.
COLOR="${COLOR:-FF3366CC}"
RENDER_NODE="${RENDER_NODE:-/dev/dri/renderD128}"

# LINEAR=1 allocates and fills a CPU-writable buffer (fails on NVIDIA; see
# above).
if [ "${LINEAR:-0}" = "1" ]; then
  MODE=()
else
  MODE=(--renderable)
fi

PRODUCER=domicile_engine_dmabuf_smoke \
PAGE="${PAGE:-$SCRIPTS/spike-page.html}" \
WINDOW_SIZE="${WINDOW_SIZE:-1024,768}" \
SOCKET="${SOCKET:-/tmp/domicile-spike-dmabuf}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-dmabuf-profile}" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--color=$COLOR" "--render-node=$RENDER_NODE" "${MODE[@]}" "$@"
