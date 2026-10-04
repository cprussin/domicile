#!/usr/bin/env bash
# Runs one spike step: starts the engine on a page whose <canvas> embeds an
# external surface, then runs a producer against it. The producer's exit code
# is the result.
#
# Runs step 3 by default. guard-css-and-resize.sh runs step 4 by calling this
# twice with PRODUCER, PAGE and WINDOW_SIZE set.
#
#   NIX_SHELL_RUN=".../scripts/spike.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Must run inside the toolchain shell: a component build links against its
# glibc.
#
#   ... spike.sh /build/chromium/src -- --color=FF00C853
#
# Flags before `--` go to the engine, after it to the producer. Exits 0 only if
# viz drew the producer's color where the canvas is.
#
# The page starts first: an <app> element exists before its window, so its
# request waits in the browser until the producer connects. The socket is open
# from browser startup, so the producer only has to start after the browser.
#
# Engine flags:
#
#   --ozone-platform=headless   default; needs no compositor. OZONE=wayland
#                               runs nested (see under-wayland.sh); headless
#                               cannot import a dmabuf
#   --disable-gpu               software compositing by default; GPU=1 uses
#                               crux's real GPU
#   --password-store=basic      otherwise Chrome blocks on a missing keyring
#                               and never opens a window
#   --no-sandbox                the producer is not a child process
#   --enable-blink-features=... canvas.embedExternalSurface() has no status in
#                               runtime_enabled_features.json5, so it must be
#                               enabled by name
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike.sh <path to chromium/src> [engine flags] [-- producer flags]" >&2
  exit 1
fi
shift

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
PAGE="${PAGE:-$SCRIPTS/spike-page.html}"
# Appended to the page's URL. Step 4 uses it to set the page's control color
# to match the producer's, since the page and producer cannot talk.
PAGE_QUERY="${PAGE_QUERY:-}"
PRODUCER="${PRODUCER:-domicile_solid_color_submitter}"
WINDOW_SIZE="${WINDOW_SIZE:-1024,768}"
# A full URL, overriding PAGE. The iframe check serves its page over HTTP so
# the <iframe> can be cross-site.
URL="${URL:-}"

# The ozone platform. `wayland` needs a compositor on $WAYLAND_DISPLAY (see
# under-wayland.sh) and is required for dmabuf import: HeadlessSurfaceFactory
# does not implement CreateNativePixmapFromHandle.
OZONE="${OZONE:-headless}"

# GPU=1 uses hardware compositing (crux has an NVIDIA GTX 970). ANGLE dlopens
# glvnd's libEGL.so.1, which Chromium's toolchain shell lacks, so GL_LIBS adds
# the Domicile full dev shell's library path.
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
# Overridable so a caller that runs this twice (`guard-css-and-resize.sh`) can
# keep each run's log.
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-spike-engine.log}"
# Remove the profile on exit: on crux /tmp is RAM that nothing else clears.
# See scripts/test-the-guards-take-their-profiles-with-them.sh.
trap 'rm -rf "$PROFILE"' EXIT

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

# TMPDIR=/tmp because Chrome binds its singleton socket under it and CHECKs
# that the path fits in 107 bytes. Nested nix shells in CI make TMPDIR longer
# than that. See test-engine-job-tmp.sh.
TMPDIR=/tmp "$OUT/chrome" \
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
  "$URL" > "$ENGINE_LOG" 2>&1 &
ENGINE=$!

# The socket appears when the page asks to embed; it is the only sign the
# renderer side got that far.
for _ in $(seq 1 60); do
  [ -S "$SOCKET" ] && break
  sleep 1
done
if [ ! -S "$SOCKET" ]; then
  echo "the page never asked to embed; see $ENGINE_LOG" >&2
  kill $ENGINE 2>/dev/null
  exit 1
fi

timeout 300 "$OUT/$PRODUCER" \
  --domicile-broker-socket="$SOCKET" "${PRODUCER_FLAGS[@]}"
RESULT=$?

kill $ENGINE 2>/dev/null
wait $ENGINE 2>/dev/null
exit $RESULT
