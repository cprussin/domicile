#!/usr/bin/env bash
# Phase 1's last assertion: a real dmabuf reaches the screen through a page.
#
#   NIX_SHELL_RUN=".../scripts/spike-wayland.sh /build/chromium/src \
#     .../scripts/spike-dmabuf.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# ALWAYS UNDER spike-wayland.sh. --ozone-platform=headless has no
# CreateNativePixmapFromHandle, so the import cannot work there — it is not
# that this is slower or less convenient headless, it is that there is nothing
# for the buffer to become. Running it headless fails at the import and says so.
#
# domicile_engine_dmabuf_smoke allocates two buffers on the render node, hands
# the fds to libdomicile_engine.so, submits one and then the other, and asks the
# browser what the display compositor drew at the centre of its window — where
# spike-page.html puts the <app>. It exits 0 only if that pixel came from the
# buffer AND `released` fired for the first one: a buffer viz has not handed
# back is one the compositor must not draw into again, so a run without it is a
# failure rather than a detail. Two submits, because one is not enough to see a
# release — viz holds whatever is on screen.
#
# RENDERABLE BY DEFAULT, and that is a finding rather than a preference.
# NVIDIA's gbm hands out a buffer the CPU can write OR one the GPU can render
# into, never both: `rendering|linear` is refused. Only the second is sampleable
# once imported — a linear buffer imports without error and then draws as the
# embedder's fallback. So the honest configuration is the one a real client
# uses, which renders with the GPU into a tiled buffer.
#
# The cost is that nothing here can put *known* content in it without a GL
# context, so the pixel assertion is "the buffer's own zeroed content rather
# than the fallback" instead of "this exact colour". LINEAR=1 runs the other
# way and fails on this driver, which is what documents the limitation.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-dmabuf.sh <path to chromium/src> [producer flags]" >&2
  exit 1
fi
shift

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

# Nothing else in the spike submits this, and it is not the page's background.
COLOR="${COLOR:-FF3366CC}"
RENDER_NODE="${RENDER_NODE:-/dev/dri/renderD128}"

# LINEAR=1 to allocate a CPU-writable buffer and fill it instead. See above:
# on NVIDIA that buffer is imported and never sampled, so the run fails.
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
