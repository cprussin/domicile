#!/usr/bin/env bash
# Phase 1's deliverable: a real Wayland client's window on the page, and the
# colour it drew coming back out of the display compositor.
#
#   NIX_SHELL_RUN=".../scripts/spike-wayland.sh /build/chromium/src \
#     .../scripts/spike-client-window.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Every pixel check before this one was the weak form — "the buffer's own zeroed
# content rather than the fallback" — because no harness had a GL context to
# draw known content with. A real client does. kitty is a real GL client and its
# background colour is settable, so the assertion here is the strong one: the
# colour the client drew.
#
# NOT YET PASSING, AND THE REASON IS THE ENVIRONMENT RATHER THAN THE PATH.
# The compositor has to see two library sets at once and currently sees one:
# the Domicile full dev shell's GL stack (without which it reports "no EGL
# renderer: serving wl_shm clients only" and no client can hand it a dmabuf at
# all) and the Chromium toolchain shell's, which is what libdomicile_engine.so
# was linked against — it needs libglib-2.0.so.0 among others. Started from
# Chromium's shell the first is missing; started from Domicile's the second is.
# Both are nix shells and neither is a superset.
#
# What that is NOT is a failure of the seam. The compositor refuses to start and
# says which library and why, which is the error path working:
#
#   Error: Library { path: "libdomicile_engine.so",
#           source: DlOpen { desc: "libglib-2.0.so.0: cannot open shared
#           object file" } }
#
# Making one environment that has both is the next thing to do here.
#
# FOUR PROCESSES, AND THE ORDER MATTERS.
#
#   sway        the nested compositor the engine runs under, because
#               --ozone-platform=headless cannot import a dmabuf. Provided by
#               spike-wayland.sh, which this runs inside
#   chrome      the forked engine, on a page whose <canvas> embeds, listening
#               on --domicile-broker-socket
#   compositor  domicile-compositor with --engine-socket pointing at that
#               socket. It is the producer now, so it holds the browser's
#               invitation and nothing else can
#   kitty       a GL client of the compositor, drawing one known colour
#
# The compositor is the only process that can ask what viz drew — one producer
# per socket — so it logs the pixel and this greps for it. That log line is
# throwaway with the rest of the spike.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-client-window.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# What the client draws and what the page must therefore show. Not the page's
# background and not a colour any other spike producer submits.
COLOR="${COLOR:-3366CC}"
# NEGATIVE=1 runs the same thing with no client at all. Nothing draws, so the
# page keeps its fallback and the assertion must fail — a green run with no
# control is not evidence.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-client-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-client-window-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
CHROME=""; COMP=""; CLI=""
cleanup() {
  kill $CHROME $COMP $CLI 2>/dev/null
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
}
trap cleanup EXIT

[ -x "$OUT/chrome" ] || { echo "build the engine first: ./scripts/build.sh $CHROMIUM" >&2; exit 1; }
[ -f "$OUT/libdomicile_engine.so" ] || {
  echo "no libdomicile_engine.so in $OUT; build it: autoninja -C $OUT domicile_engine" >&2
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  echo "build the compositor first: nix develop .#full -c cargo build -p domicile-compositor" >&2
  exit 1
}
# kitty lives in the Domicile full dev shell, not in Chromium's toolchain shell
# — and this runs inside the latter. Fetched the way spike-wayland.sh fetches
# sway, so the check does not depend on which shell it was started from.
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  echo "SKIP: no kitty to draw with, and no nix to fetch one."
  exit 77
fi

cd "$CHROMIUM" || exit 1
rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# The engine, on the page that embeds. GPU because a dmabuf import needs one,
# and wayland because headless ozone has no CreateNativePixmapFromHandle.
"$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-page.html" >"$ENGINE_LOG" 2>&1 &
CHROME=$!

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  echo "the page never asked to embed; the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

# The compositor, as the producer. libdomicile_engine.so is dlopened by name.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-client-window.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!

for _ in $(seq 1 120); do
  grep -q "brokered a frame sink" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi

# Which wayland socket it opened for apps.
CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

if [ "$NEGATIVE" = "1" ]; then
  echo "negative control: no client, so nothing draws"
else
  echo "driving kitty, drawing #$COLOR"
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout 120 \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$COLOR" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do sleep 0.2; done' >"$CLI_LOG" 2>&1 &
  CLI=$!
fi

# The compositor logs what viz drew each time it submits.
DRAWN=""
for _ in $(seq 1 60); do
  DRAWN=$(grep -oE "engine drew #[0-9A-F]{8}" "$COMP_LOG" | tail -1 | grep -oE "[0-9A-F]{8}$")
  [ -n "$DRAWN" ] && break
  sleep 1
done

echo
if [ -z "$DRAWN" ]; then
  echo "the engine never drew a client frame"
  echo "--- the compositor's last words:"
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /'
  [ "$NEGATIVE" = "1" ] && { echo "negative control: correct, nothing drew"; exit 0; }
  exit 1
fi

echo "the engine drew #$DRAWN; the client drew #$COLOR"
# kitty's background is opaque, so the alpha is FF and the low 24 bits are the
# colour. Compared as a string because the colour is exact: a client's own
# buffer is not resampled on the way to the page.
if [ "${DRAWN#FF}" = "$COLOR" ]; then
  if [ "$NEGATIVE" = "1" ]; then
    echo "NEGATIVE CONTROL FAILED: something drew when nothing should have" >&2
    exit 1
  fi
  echo "PASS: a Wayland client's own window is on the page, in its own colour"
  exit 0
fi
echo "FAIL: the page is showing something that is not the client's buffer" >&2
exit 1
