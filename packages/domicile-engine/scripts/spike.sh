#!/usr/bin/env bash
# Run step 3 of the spike: start the engine on a page whose <canvas> embeds an
# external surface, then run the producer against it and check what viz drew.
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
#   --ozone-platform=headless   crux has no display server and no Wayland
#                               compositor. This is why build.sh turns
#                               ozone_platform_headless on
#   --disable-gpu               software compositing. Solid-colour quads need
#                               no GPU resources, which is half of why the
#                               producer submits them
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

if [ ! -x "$OUT/chrome" ] || [ ! -x "$OUT/domicile_solid_color_submitter" ]; then
  echo "build them first: ./scripts/build.sh $CHROMIUM" >&2
  exit 1
fi
if [ ! -f "$PAGE" ]; then
  echo "no page at $PAGE" >&2
  exit 1
fi

rm -f "$SOCKET"
rm -rf "$PROFILE" && mkdir -p "$PROFILE"

"$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --no-sandbox \
  --password-store=basic \
  --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$SOCKET" \
  "${ENGINE_FLAGS[@]}" \
  "file://$PAGE" > /tmp/domicile-spike-engine.log 2>&1 &
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

timeout 180 "$OUT/domicile_solid_color_submitter" \
  --domicile-broker-socket="$SOCKET" "${PRODUCER_FLAGS[@]}"
RESULT=$?

kill $ENGINE 2>/dev/null
wait $ENGINE 2>/dev/null
exit $RESULT
