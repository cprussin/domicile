#!/usr/bin/env bash
# Run one step of the spike: start the engine on a page whose <canvas> embeds an
# external surface, then run a producer against it and let the producer's exit
# code be the verdict.
#
# Step 3 is the default. Step 4's measurement is spike-step4.sh, which is this
# script twice with PRODUCER, PAGE and WINDOW_SIZE set.
#
#   NIX_SHELL_RUN=".../scripts/spike.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Inside the toolchain shell, like everything else here: a component build links
# against that shell's glibc and will not start without it.
#
#   ... spike.sh /build/chromium/src -- --color=FF00C853
#
# Flags before `--` go to the engine, after it to the producer. Exits 0 only if
# the pixel viz drew where the canvas is is the one the producer sent.
#
# The order matters and is not the obvious one. The engine opens the broker
# socket when a page first asks to embed, not at startup — there is no startup
# hook in the series any more — so the page runs first, its request waits in the
# browser, and the producer that turns up later is what completes it.
#
# The engine flags are not incidental, and each is here because it was needed:
#
#   --ozone-platform=headless   the default, and the only one that needs no
#                               compositor. OZONE=wayland runs under a nested
#                               one instead — see spike-wayland.sh, and note
#                               that headless CANNOT import a dmabuf
#   --disable-gpu               software compositing, and only by default. See
#                               GPU=1 below: crux turns out to have a real GPU,
#                               so this is a choice rather than a constraint
#   --password-store=basic      without it Chrome blocks on a keyring that is
#                               not there, and never creates a window
#   --no-sandbox                the producer is not a child process
#   --enable-blink-features=... canvas.embedExternalSurface() is statusless in
#                               runtime_enabled_features.json5, so naming it is
#                               the only way to turn it on
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike.sh <path to chromium/src> [engine flags] [-- producer flags]" >&2
  exit 1
fi
shift

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
PAGE="${PAGE:-$SCRIPTS/spike-page.html}"
# Appended to the page's URL. Step 4 uses it to tell the page which colour its
# control elements have to be, because there is no channel from the page to the
# producer and the harness is what makes the two agree.
PAGE_QUERY="${PAGE_QUERY:-}"
PRODUCER="${PRODUCER:-domicile_solid_color_submitter}"
WINDOW_SIZE="${WINDOW_SIZE:-1024,768}"
# The whole URL, when a check needs one this cannot build from a file path —
# the iframe check is served over HTTP so that its <iframe> can be cross-site.
URL="${URL:-}"

# GPU=1 runs the engine on real hardware instead of software compositing.
#
# crux has a GTX 970 on the proprietary driver and Chromium drives it — the
# renderer string is "ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 970/PCIe/
# SSE2, OpenGL ES 3.2)". What kept every earlier measurement on --disable-gpu
# was not the absence of a GPU but the absence of a library path: ANGLE dlopens
# libEGL.so.1, which is glvnd's, and Chromium's own toolchain shell does not
# carry it. GL_LIBS is that path, and it is the Domicile full dev shell's.
# Which ozone platform to run on. `headless` needs nothing and is the default.
# `wayland` needs a compositor on $WAYLAND_DISPLAY — spike-wayland.sh brings one
# up — and is the only way to reach a dmabuf import: HeadlessSurfaceFactory does
# not implement CreateNativePixmapFromHandle, so under headless there is nothing
# for an imported buffer to become.
OZONE="${OZONE:-headless}"

GPU="${GPU:-0}"
GL_LIBS="${GL_LIBS:-/run/opengl-driver/lib:/nix/store/dwc1r464zf5379jr69vv9gl84h28bzc0-libglvnd-1.7.0/lib:/nix/store/vpfv85fjpjjcx8184a8vhch0kdygchql-mesa-26.2.0/lib:/nix/store/qdz5ms1bzjpjq2nx4pvsjq629gqm7g6g-mesa-libgbm-26.1.3/lib}"

if [ "$GPU" = "1" ]; then
  GPU_FLAGS=()
  export LD_LIBRARY_PATH="$GL_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
else
  GPU_FLAGS=(--disable-gpu)
fi

OUT="${OUT:-out/Domicile}"
SOCKET="${SOCKET:-/tmp/domicile-spike}"
PROFILE="${PROFILE:-/tmp/domicile-spike-profile}"

ENGINE_FLAGS=()
PRODUCER_FLAGS=()
AFTER_DASHES=0
for arg in "$@"; do
  if [ "$arg" = "--" ]; then AFTER_DASHES=1; continue; fi
  if [ $AFTER_DASHES -eq 0 ]; then
    ENGINE_FLAGS+=("$arg")
  else
    PRODUCER_FLAGS+=("$arg")
  fi
done

cd "$CHROMIUM" || exit 1

if [ ! -x "$OUT/chrome" ] || [ ! -x "$OUT/$PRODUCER" ]; then
  echo "build them first: ./scripts/build.sh $CHROMIUM" >&2
  exit 1
fi
if [ -z "$URL" ] && [ ! -f "$PAGE" ]; then
  echo "no page at $PAGE" >&2
  exit 1
fi
[ -n "$URL" ] || URL="file://$PAGE$PAGE_QUERY"

rm -f "$SOCKET"
rm -rf "$PROFILE" && mkdir -p "$PROFILE"

"$OUT/chrome" \
  --ozone-platform="$OZONE" \
  "${GPU_FLAGS[@]}" \
  --no-sandbox \
  --password-store=basic \
  --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WINDOW_SIZE" \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$SOCKET" \
  "${ENGINE_FLAGS[@]}" \
  "$URL" > /tmp/domicile-spike-engine.log 2>&1 &
ENGINE=$!

# The socket appearing is the page having asked to embed, which is the only
# signal that the renderer half got that far.
for _ in $(seq 1 60); do
  [ -S "$SOCKET" ] && break
  sleep 1
done
if [ ! -S "$SOCKET" ]; then
  echo "the page never asked to embed; see /tmp/domicile-spike-engine.log" >&2
  kill $ENGINE 2>/dev/null
  exit 1
fi

timeout 300 "$OUT/$PRODUCER" \
  --domicile-broker-socket="$SOCKET" "${PRODUCER_FLAGS[@]}"
RESULT=$?

kill $ENGINE 2>/dev/null
wait $ENGINE 2>/dev/null
exit $RESULT
