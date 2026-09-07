#!/usr/bin/env bash
# Two Wayland clients, two windows, one page — the claim nothing had ever made.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/spike-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/spike-two-windows.sh /build/chromium/src
#
# From Domicile's full shell, not Chromium's, for the reason
# spike-client-window.sh gives: `engineRuntimeLibs` puts Chromium's runtime
# libraries beside the GL stack and this needs both.
#
# WHY THIS EXISTS. frame_sink_broker_unittest asserts that two apps get two
# sinks and that a waiting embed takes only its own app's. That is the broker's
# bookkeeping. Whether viz then resolves two SurfaceDrawQuads in one
# aggregation — two processes' buffers composited into one page — is a
# different question, and until this script existed nothing had asked it. A
# shell is a desktop of windows, so it is the question that decides whether the
# seam is finished.
#
# The one-window heuristic this replaced (`MostRecentlyBrokeredSink`) would
# pass a test that only checked the first window. That is what the negative
# control below is built to catch: with one client running, the SECOND canvas
# must show its own fallback and not the first client's colour.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-two-windows.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Two colours, neither of them either canvas's fallback (#3f51b5, #00796b) and
# neither the other's. A guard where the two windows could be confused for each
# other is the guard not being run.
COLOR_A="${COLOR_A:-3366CC}"
COLOR_B="${COLOR_B:-CC6633}"
APP_A="${APP_A:-app-1}"
APP_B="${APP_B:-app-2}"

# NEGATIVE=1 runs one client instead of two. The first window must still be
# right and the second must NOT be the first — which is the failure a broker
# that dispatches on nothing produces, and the failure a two-window run with
# both clients up cannot distinguish from success.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-two-windows-broker}"
PROFILE="${PROFILE:-/tmp/domicile-two-windows-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

# The window, and the two points inside it. The page splits the viewport in
# half, so a quarter and three quarters of the width are one canvas each, and
# half the height is inside both.
#
# Window coordinates are bitmap coordinates: SamplePixel indexes the same
# capture of the window's root layer that SampleWindowCenter halves. That makes
# these correct at scale 1, which is what spike-wayland.sh's headless output
# gives. At any other scale the points land somewhere else in the window and
# the assertion fails rather than quietly sampling the wrong canvas — the
# colours it looks for are specific.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
PROBE_A_X=$((WIDTH / 4))
PROBE_B_X=$((WIDTH * 3 / 4))
PROBE_Y=$((HEIGHT / 2))

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
STARTED=()
LOG_COPY="${LOG_COPY:-/tmp/domicile-two-windows-compositor.log}"
# The browser's own log, which used to be thrown away with the tempfile.
# It is where the page's console lines are — which element embedded which
# app, and which was refused — and a run where the page showed the wrong
# window cannot be told apart from one where a client never drew without
# them.
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-two-windows-engine.log}"
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
}
trap cleanup EXIT

cd "$CHROMIUM" || exit 1

[ -x "$OUT/chrome" ] || { echo "build the engine first: ./scripts/build.sh $CHROMIUM" >&2; exit 1; }
[ -f "$OUT/libdomicile_engine.so" ] || {
  echo "no libdomicile_engine.so in $OUT; build it: autoninja -C $OUT domicile_engine" >&2
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  echo "build the compositor first: nix develop .#full -c cargo build -p domicile-compositor" >&2
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  echo "SKIP: no kitty to draw with, and no nix to fetch one."
  exit 77
fi

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

"$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-two-windows.html?a=$APP_A&b=$APP_B" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  echo "the page never asked to embed; the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

# The compositor, told where to look. Without DOMICILE_SPIKE_PROBE it samples
# the window's centre, which on this page is the seam between the two canvases
# and inside neither.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-two-windows.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_PROBE="$PROBE_A_X,$PROBE_Y;$PROBE_B_X,$PROBE_Y" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

for _ in $(seq 1 120); do
  grep -q "wayland-[0-9]" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi

CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

# One client at a time, and the second only once the first has been brokered.
# The app ids are the compositor's own, minted in the order windows appear, so
# starting both at once would make which client is app-1 a race — and the page
# named app-1 and app-2 before either existed.
start_client() {
  local colour="$1"
  echo "driving kitty, drawing #$colour"
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout 180 \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$colour" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do sleep 0.2; done' >>"$CLI_LOG" 2>&1 &
  STARTED+=($!)
}

# Two greps rather than one pattern: tracing colours its field names, so
# `app_id=app-1` is not contiguous in the file even though it looks it on a
# terminal. The message is one format string and has no escapes inside it, and
# the value does not either, so matching them separately is what works.
await_broker() {
  local app="$1"
  for _ in $(seq 1 60); do
    if grep -a "brokered a frame sink" "$COMP_LOG" 2>/dev/null |
         grep -q -- "$app"; then
      return 0
    fi
    sleep 1
  done
  echo "no frame sink was ever brokered for $app" >&2
  grep -aE "brokered|frame sink|app_id" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  return 1
}

start_client "$COLOR_A"
await_broker "$APP_A" || exit 1

if [ "$NEGATIVE" = "1" ]; then
  echo "negative control: only one client, so the second canvas must stay its own colour"
else
  start_client "$COLOR_B"
  await_broker "$APP_B" || exit 1
fi

# What viz drew at each point, most recent wins. Two separate greps rather than
# one, because the two points are logged independently and a run where only one
# of them ever appeared is exactly the half-failure worth naming.
drawn_at() {
  grep -aoE "engine drew #[0-9A-F]{8} at \($1,$PROBE_Y\)" "$COMP_LOG" 2>/dev/null |
    tail -1 | grep -oE "#[0-9A-F]{8}" | tr -d '#'
}

DREW_A=""
DREW_B=""
for _ in $(seq 1 90); do
  DREW_A=$(drawn_at "$PROBE_A_X")
  DREW_B=$(drawn_at "$PROBE_B_X")
  if [ "$NEGATIVE" = "1" ]; then
    [ -n "$DREW_A" ] && [ -n "$DREW_B" ] && break
  else
    [ "${DREW_A#FF}" = "$COLOR_A" ] && [ "${DREW_B#FF}" = "$COLOR_B" ] && break
  fi
  sleep 1
done

echo
echo "at ($PROBE_A_X,$PROBE_Y): #${DREW_A:-nothing}   expected #FF$COLOR_A"
echo "at ($PROBE_B_X,$PROBE_Y): #${DREW_B:-nothing}   expected #FF$COLOR_B"

if [ -z "$DREW_A" ] && [ -z "$DREW_B" ]; then
  echo "the engine never drew a client frame at either point"
  echo "--- the compositor's last words:"
  grep -aE "engine|frame sink|buffer|dmabuf|SPIKE_PROBE" "$COMP_LOG" | tail -12 | sed 's/^/  /'
  exit 1
fi

if [ "$NEGATIVE" = "1" ]; then
  # The first window must be right — a control that fails because nothing
  # worked proves nothing about dispatch.
  if [ "${DREW_A#FF}" != "$COLOR_A" ]; then
    echo "NEGATIVE CONTROL INCONCLUSIVE: the one client that is running did not draw" >&2
    exit 1
  fi
  if [ "${DREW_B#FF}" = "$COLOR_A" ]; then
    echo "NEGATIVE CONTROL FAILED: the second canvas is showing the first client's" \
         "window, so the embed is not dispatched on app id at all" >&2
    exit 1
  fi
  echo "negative control: correct, the second canvas is not the first client's window"
  exit 0
fi

if [ "${DREW_A#FF}" = "$COLOR_A" ] && [ "${DREW_B#FF}" = "$COLOR_B" ]; then
  echo "PASS: two clients' windows are on one page, each in its own colour"
  exit 0
fi

echo "FAIL: the page is not showing both clients' buffers" >&2
if [ "${DREW_A#FF}" = "${DREW_B#FF}" ]; then
  echo "  both canvases show the same colour, which is one surface embedded twice" >&2
fi
exit 1
