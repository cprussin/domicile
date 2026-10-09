#!/usr/bin/env bash
# Checks that a real Wayland client's window reaches the page in the color it
# drew.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-client-window.sh /build/chromium/src
#
# Run from Domicile's full shell: it has both the GL stack (for client
# dmabufs) and Chromium's runtime libraries (for libdomicile_engine.so).
#
# kitty draws a known background color, so the guard asserts that exact color.
#
# Processes, started in this order:
#
#   sway        nested compositor from under-wayland.sh; headless Ozone cannot
#               import a dmabuf
#   chrome      the engine on an embedding page, listening on
#               --domicile-broker-socket
#   compositor  domicile-compositor, the producer on that socket
#   kitty       a GL client of the compositor, drawing one color
#
# Only the producer can read back what viz drew, so the compositor logs the
# pixel and this greps for it.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-client-window: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# The client's color. Differs from the page background and other producers.
COLOR="${COLOR:-3366CC}"
# The page embeds by app id, so it must match the client's.
CLIENT_APP_ID="${CLIENT_APP_ID:-app-1}"
# NEGATIVE=1 starts no client, so the assertion must fail.
NEGATIVE="${NEGATIVE:-0}"

# Client lifetime in seconds. Must outlast the poll: the probe runs on the
# submit path, so a client killed mid-poll reads as "nothing drew".
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-client-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-client-window-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
# An array, since some processes may never start and `kill ""` is an error.
STARTED=()
# Keep both logs for diagnosis: the compositor's says which app id it brokered,
# and the engine's has the page's console lines. The negative control gets its
# own files so it does not overwrite the run's.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-client-window$WHICH-compositor.log}"
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-client-window$WHICH-engine.log}"
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
  rm -rf "$PROFILE"
}
trap cleanup EXIT

# OUT is relative to the checkout.
cd "$CHROMIUM" || {
  annotate "guard-client-window: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  annotate "guard-client-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  annotate "guard-client-window: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-client-window: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
# kitty is not in Chromium's toolchain shell, so fetch it with nix if missing.
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-client-window: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Wayland with GPU: headless Ozone has no CreateNativePixmapFromHandle, and a
# dmabuf import needs a GPU.
"$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-page.html?app=$CLIENT_APP_ID" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-client-window: the page never asked to embed" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

# libdomicile_engine.so is dlopened by name. DOMICILE_SPIKE_CENTER enables the
# `engine drew` lines polled below; each is a readback on the submit path.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-client-window.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_CENTER=1 \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" \
    --expect-a-page no >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

# Wait for the compositor only. `chrome protocol socket up` is logged after the
# Wayland socket opens and needs no client. Do not wait for a frame sink here:
# that needs a client, which starts below.
# scripts/test-the-client-window-guard-waits-for-the-compositor.sh checks this.
COMPOSITOR_LOOKS="${COMPOSITOR_LOOKS:-120}"

UP=0
for _ in $(seq 1 "$COMPOSITOR_LOOKS"); do
  grep -q "chrome protocol socket up" "$COMP_LOG" 2>/dev/null && { UP=1; break; }
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "guard-client-window: the compositor did not start" "$COMP_LOG"
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
# Starting a client before the sockets are up would test the harness, not the
# engine.
if [ "$UP" != "1" ]; then
  annotate_from "guard-client-window: the compositor is running and never bound its chrome socket" "$COMP_LOG"
  echo "the compositor is running and never bound its chrome socket. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
echo "the compositor is up, and nothing has asked it for a window yet"

# Which wayland socket it opened for apps.
CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

if [ "$NEGATIVE" = "1" ]; then
  echo "negative control: no client, so nothing draws"
else
  echo "driving kitty, drawing #$COLOR"
  # Keep kitty committing frames: the probe runs on the submit path, and
  # kitty stops redrawing its cursor blink after about 15 seconds. The dots
  # are foreground pixels and do not affect the background color.
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$COLOR" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do printf .; sleep 0.2; done' >"$CLI_LOG" 2>&1 &
  STARTED+=($!)
fi

# Poll the compositor's `engine drew` lines.
#
# The guard stops as soon as the client's color appears. The negative control
# never sees a draw, so it waits a multiple of the guard's measured time
# instead of the full budget. See lib-control-budget.sh.
#
# 240 seconds covers a render node shared with another job on `crux`, which
# can slow a draw several times over. It costs nothing on a healthy run.
# CLIENT_LIVES_FOR must exceed it.
LOOKS="${LOOKS:-240}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for client-window "$LOOKS")"

# Wait for the client's color, not any draw: spike-page.html paints its own
# indigo first. `DRAWN` keeps the last draw for the timeout message.
DRAWN=""
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  DRAWN=$(grep -oE "engine drew #[0-9A-F]{8}" "$COMP_LOG" | tail -1 | grep -oE "[0-9A-F]{8}$")
  [ "${DRAWN#FF}" = "$COLOR" ] && break
  sleep 1
  WAITED=$((WAITED + 1))
done

# Record the wait only when the guard saw the client's color. A timeout is not
# a measurement and would give the control its largest budget.
if [ "$NEGATIVE" != "1" ] && [ "${DRAWN#FF}" = "$COLOR" ]; then
  budget_note client-window "$WAITED"
fi

echo
if [ -z "$DRAWN" ]; then
  echo "the engine never drew a client frame"
  echo "--- the compositor's last words:"
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /'
  [ "$NEGATIVE" = "1" ] && { echo "PASS: negative control: correct, nothing drew"; exit 0; }
  annotate_from "guard-client-window: the engine never drew a client frame" "$COMP_LOG"
  exit 1
fi

echo "the engine drew #$DRAWN; the client drew #$COLOR"
# kitty's background is opaque (alpha FF). The client's buffer is not
# resampled, so compare the color exactly.
if [ "${DRAWN#FF}" = "$COLOR" ]; then
  if [ "$NEGATIVE" = "1" ]; then
    annotate "guard-client-window negative control: something drew when nothing should have"
    exit 1
  fi
  echo "PASS: a Wayland client's own window is on the page, in its own color"
  exit 0
fi
annotate "guard-client-window: the page is showing #$DRAWN, which is not the client's #$COLOR"
exit 1
