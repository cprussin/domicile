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
# control below is built to catch: with one client running, the second client's
# colour must be nowhere on the page.
#
# WHAT IT ASSERTS. Where each client's colour *is*, as a box, and that the two
# boxes are side by side and do not overlap. Not what colour is at a named
# point: those points were computed from the window size the browser was asked
# for, the capture came back half again as large, and three quarters of the
# asked-for width landed inside the left canvas of the real one. The guard read
# the first client's colour twice and reported the seam broken while the seam
# was working.
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

# What the browser is asked for. NOT what the assertion is computed from —
# see the box comparison at the bottom. The window this produced came back from
# a CopyOutputRequest as 1620x1220, so any coordinate derived from these two
# numbers is a coordinate in a space that does not exist.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
STARTED=()
# A run and its own negative control are two different measurements, so they
# get two different files. Sharing one meant the control's logs overwrote the
# run's and the diagnostics printed whichever went last — which, when the two
# disagree, is exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-two-windows$WHICH-compositor.log}"
# The browser's own log, which used to be thrown away with the tempfile. It is
# where the page's console lines are — which app was embedded, at which
# SurfaceId, and which was refused — and a run where the page showed the wrong
# window cannot be told apart from one where a client never drew without them.
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-two-windows$WHICH-engine.log}"
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

# The compositor, told which colours to look for. No DOMICILE_SPIKE_PROBE:
# this guard names no points, so it needs no coordinate space to name them in,
# and the centre — which on this page is the seam between the two canvases and
# inside neither — is not sampled either.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-two-windows.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR_A;$COLOR_B" \
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

# WHERE each colour is, not what is at a named point.
#
# The points were the original assertion and they were wrong — not about the
# seam, about arithmetic. They were computed from the `--window-size` the
# browser was asked for, and what SamplePixel indexes is the bitmap a
# CopyOutputRequest returns, which on this harness came back 1620x1220 for a
# window asked for at 1024x768. Three quarters of 1024 is 768, and 768 is
# inside the LEFT canvas of a 1620-wide capture. So the guard read the first
# client's colour twice and called the seam broken, and the seam was fine.
#
# Boxes have no such assumption in them, and they assert something stronger
# than two points ever did: two clients' windows, side by side, not overlapping
# — which is exactly "viz aggregated two surfaces from a process outside the
# browser into one page's layer tree" and is the whole question this script
# exists to ask.
box_of() {
  grep -aoE "engine found #FF$1 over \([0-9]+,[0-9]+\) [0-9]+x[0-9]+" "$COMP_LOG" \
    2>/dev/null | tail -1
}

# `(x,y) WxH` -> the four numbers, space separated.
numbers_in() {
  echo "$1" | grep -oE "[0-9]+" | tr '\n' ' '
}

BOX_A=""
BOX_B=""
for _ in $(seq 1 90); do
  BOX_A=$(box_of "$COLOR_A")
  BOX_B=$(box_of "$COLOR_B")
  if [ "$NEGATIVE" = "1" ]; then
    # Nothing to wait for but the one client: the control's whole claim is that
    # the other colour never turns up, and waiting for it to would be waiting
    # for the run to fail.
    [ -n "$BOX_A" ] && break
  else
    [ -n "$BOX_A" ] && [ -n "$BOX_B" ] && break
  fi
  sleep 1
done

echo
echo "#$COLOR_A: ${BOX_A:-nowhere in the window}"
echo "#$COLOR_B: ${BOX_B:-nowhere in the window}"
echo "everything the probe said:"
grep -aoE "engine (found|has not drawn|could not read the window at all looking for) #[0-9A-F]{8}.*" \
  "$COMP_LOG" 2>/dev/null |
  sort -u | sed 's/^/  /'

# A search that stopped is not a search that found nothing, and reporting the
# first as the second is how a slow runner becomes a wrong diagnosis.
if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
  echo "INCONCLUSIVE: the compositor stopped searching before this poll ran out," \
       "so 'not found' here means 'not looked for'." >&2
  exit 1
fi

if [ -z "$BOX_A" ]; then
  echo "INCONCLUSIVE: the first client never reached the page at all, so nothing" \
       "here is about two windows." >&2
  echo "--- the compositor's last words:" >&2
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  exit 1
fi

if [ "$NEGATIVE" = "1" ]; then
  if [ -n "$BOX_B" ]; then
    echo "NEGATIVE CONTROL FAILED: #$COLOR_B is on screen and no client drew it." >&2
    exit 1
  fi
  echo "negative control: correct, only the running client's window is on the page"
  exit 0
fi

if [ -z "$BOX_B" ]; then
  echo "FAIL: only one client's window reached the page; #$COLOR_B is nowhere in it" >&2
  exit 1
fi

# Side by side and disjoint. Read as: A ends before B begins.
set -- $(numbers_in "$BOX_A"); A_X="$1"; A_W="$3"
set -- $(numbers_in "$BOX_B"); B_X="$1"; B_W="$3"
A_RIGHT=$((A_X + A_W))
B_RIGHT=$((B_X + B_W))

if [ "$A_RIGHT" -le "$B_X" ]; then
  echo "PASS: two clients' windows are on one page, side by side —" \
       "#$COLOR_A across $A_X..$A_RIGHT and #$COLOR_B across $B_X..$B_RIGHT"
  exit 0
fi

echo "FAIL: the two clients' windows overlap, so they are not two windows" >&2
echo "  #$COLOR_A across $A_X..$A_RIGHT, #$COLOR_B across $B_X..$B_RIGHT" >&2
exit 1
