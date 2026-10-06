#!/usr/bin/env bash
# Checks that two Wayland clients appear as two windows on one page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-two-windows.sh /build/chromium/src
#
# Run it in the `.#full` dev shell: it needs Chromium's runtime libraries and
# the GL stack (`engineRuntimeLibs`; see guard-client-window.sh).
#
# frame_sink_broker_unittest covers the broker's bookkeeping. This checks that
# viz composites two clients' surfaces into one page. The negative control
# catches a broker that gives every embed the same surface.
#
# It asserts where each client's color is, as a box: the two boxes must sit
# side by side without overlapping. It does not sample named points, because
# the captured window is larger than `--window-size` asked for.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-two-windows: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Distinct from each other and from the canvas fallbacks (#3f51b5, #00796b).
COLOR_A="${COLOR_A:-3366CC}"
COLOR_B="${COLOR_B:-CC6633}"
APP_A="${APP_A:-app-1}"
APP_B="${APP_B:-app-2}"

# NEGATIVE=1 runs one client instead of two. It must fill its own half and no
# more; a broker that ignores app ids would show it across the whole page.
NEGATIVE="${NEGATIVE:-0}"

# How long a client lives. It must outlast the 60s wait for the second sink
# plus 90s of polling, because the search runs on the submit path and stops
# when the client exits. 420 leaves room.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

# Colors the compositor searches for. The negative run omits the second color:
# "settled" means every requested color was found and none moved, so asking
# for an undrawn color would never settle. The control checks how much of the
# page the one client covers instead.
FIND_COLORS="$COLOR_A;$COLOR_B"
[ "$NEGATIVE" = "1" ] && FIND_COLORS="$COLOR_A"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-two-windows-broker}"
PROFILE="${PROFILE:-/tmp/domicile-two-windows-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

# The requested window size. Assertions do not use it: the capture comes back
# larger (1620x1220 on this harness). See the box comparison below.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
STARTED=()
# A run and its negative control write separate log files so both can be
# read side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-two-windows$WHICH-compositor.log}"
# Keep the browser's log: its console lines say which app was embedded at
# which SurfaceId and which was refused.
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-two-windows$WHICH-engine.log}"
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

cd "$CHROMIUM" || {
  annotate "guard-two-windows: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  annotate "guard-two-windows: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  annotate "guard-two-windows: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-two-windows: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-two-windows: no kitty to draw with, and no nix to fetch one"
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
  "file://$SCRIPTS/guard-two-windows.html?a=$APP_A&b=$APP_B" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-two-windows: the page never asked to embed" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

# The compositor, told which colors to find. No DOMICILE_SPIKE_PROBE: the
# guard names no points.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-two-windows.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$FIND_COLORS" \
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
  annotate_from "guard-two-windows: the compositor did not start" "$COMP_LOG"
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi

CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

# Start the second client only after the first is brokered. The compositor
# assigns app ids in mapping order, and the page names app-1 and app-2 up front.
start_client() {
  local color="$1"
  echo "driving kitty, drawing #$color"
  # Keep the client printing. The probe runs only when a client commits a
  # frame, and kitty stops redrawing after its cursor blink times out (~15s).
  # The dots are foreground pixels; the probe measures the background color.
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$color" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do printf .; sleep 0.2; done' >>"$CLI_LOG" 2>&1 &
  STARTED+=($!)
}

# Two greps: tracing colors its field names, so `app_id=app-1` is not
# contiguous in the file.
await_broker() {
  local app="$1"
  for _ in $(seq 1 60); do
    if grep -a "brokered a frame sink" "$COMP_LOG" 2>/dev/null |
         grep -q -- "$app"; then
      return 0
    fi
    sleep 1
  done
  annotate "guard-two-windows: no frame sink was ever brokered for $app"
  grep -aE "brokered|frame sink|app_id" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  return 1
}

start_client "$COLOR_A"
await_broker "$APP_A" || exit 1

if [ "$NEGATIVE" = "1" ]; then
  echo "negative control: one client, which must fill one half and not the page"
else
  start_client "$COLOR_B"
  await_broker "$APP_B" || exit 1
fi

# The box the compositor last logged for color $1.
box_of() {
  # Return only the geometry: the color string (e.g. `#FF3366CC`) contains
  # digit runs that would otherwise be read as coordinates.
  grep -aoE "engine found #FF$1 over \([0-9]+,[0-9]+\) [0-9]+x[0-9]+" "$COMP_LOG" \
    2>/dev/null | tail -1 | grep -oE "\([0-9]+,[0-9]+\) [0-9]+x[0-9]+"
}

# The captured window's size, to compare boxes against.
window_size() {
  grep -aoE "of the browser's [0-9]+x[0-9]+ window" "$COMP_LOG" 2>/dev/null |
    tail -1 | grep -oE "[0-9]+x[0-9]+"
}

# `(x,y) WxH` -> x y w h, space separated.
numbers_in() {
  echo "$1" | grep -oE "[0-9]+" | tr '\n' ' '
}

# Wait for the compositor to log `engine settled`: a round found every
# requested color and no box moved since the last round.
#
# A log that stops changing is not enough: boxes are logged only when they
# move, and the search stops when clients stop submitting. Both runs wait for
# this, which is why the negative run asks only for a color that exists.
POLL_EVERY=3
LOOKS=30

SETTLED=0
LOOKED=0
for _ in $(seq 1 "$LOOKS"); do
  LOOKED=$((LOOKED + 1))
  if grep -aq "engine settled" "$COMP_LOG" 2>/dev/null; then
    SETTLED=1
    break
  fi
  sleep "$POLL_EVERY"
done

BOX_A=$(box_of "$COLOR_A")
BOX_B=$(box_of "$COLOR_B")
WINDOW=$(window_size)

# Distinguish the ways the run can have measured nothing before asserting on
# boxes, so the failure names the right cause.
#
# The first is unreachable today (the compositor searches for 300s, `FIND_FOR`;
# this polls at most 150s after the first frame). It guards against someone
# lengthening the poll.
if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
  annotate "guard-two-windows: the compositor stopped searching before" \
       "this poll ran out, so 'not found' here means 'not looked for'"
  exit 1
fi
if [ -z "$BOX_A" ]; then
  annotate "guard-two-windows: the first client's color never appeared" \
       "on the page at all, so nothing here is about two windows"
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  exit 1
fi
if [ -z "$WINDOW" ]; then
  annotate "guard-two-windows: the probe never reported the window's size," \
       "so there is nothing to measure the boxes against"
  exit 1
fi
if [ "$SETTLED" != "1" ]; then
  annotate "guard-two-windows: the compositor never said it had settled" \
       "after $((LOOKED * POLL_EVERY))s, so what it had measured was still" \
       "moving. A client that stops drawing stops the search: it runs on the" \
       "submit path"
  echo "  #$COLOR_A: ${BOX_A:-nowhere}" >&2
  if [ "$NEGATIVE" = "1" ]; then
    echo "  #$COLOR_B: not searched for — no client is drawing it" >&2
  else
    echo "  #$COLOR_B: ${BOX_B:-nowhere}" >&2
  fi
  exit 1
fi

echo
echo "#$COLOR_A: ${BOX_A:-nowhere in the window}"
# The negative run never searches for it, so do not report it as missing.
if [ "$NEGATIVE" = "1" ]; then
  echo "#$COLOR_B: not searched for — no client is drawing it"
else
  echo "#$COLOR_B: ${BOX_B:-nowhere in the window}"
fi
echo "everything the probe said, in the order it said it — a box appears again"
echo "each time it moves, and watching one settle is what these lines are for:"
grep -aoE "engine (found|has not drawn|could not read the window at all looking for|settled).*" \
  "$COMP_LOG" 2>/dev/null | sed 's/^/  /'

if [ "$NEGATIVE" = "1" ]; then
  # The other color being absent proves nothing: nobody draws it. What
  # matters is how much of the page client A covers. With dispatch by app id,
  # canvas B stays empty and A fills its half. Without it, canvas B embeds A
  # too and A spans the page. So the control bounds A's width from above.
  read -r A_X A_Y A_W A_H <<EOF
$(numbers_in "$BOX_A")
EOF
  WINDOW_W=$(echo "$WINDOW" | cut -dx -f1)
  # Lower bound: A covers its half, not a sliver. Upper bound: canvas B is
  # not showing it too.
  LEAST=$((WINDOW_W * 45 / 100))
  MOST=$((WINDOW_W * 55 / 100))
  echo
  echo "in a $WINDOW window: #$COLOR_A is ${A_W}x${A_H} at $A_X,$A_Y"
  if [ "$A_W" -lt "$LEAST" ]; then
    annotate "guard-two-windows negative control: the one client's window is" \
         "only ${A_W}px of a ${WINDOW_W}px page, so this measured a sliver rather" \
         "than a window and says nothing about dispatch"
    exit 1
  fi
  if [ "$A_W" -ge "$MOST" ]; then
    annotate "guard-two-windows negative control: the one client's window" \
         "is ${A_W}px of a ${WINDOW_W}px page, so both canvases are showing it" \
         "and the embed is not dispatched on app id at all"
    exit 1
  fi
  echo "PASS: negative control: correct, the one running client fills its own half and" \
       "the other canvas is not showing it"
  exit 0
fi

if [ -z "$BOX_B" ]; then
  annotate "guard-two-windows: only one client's window reached the page; #$COLOR_B is nowhere in it"
  exit 1
fi

# Disjoint, and each about half the window the probe reported. Disjointness
# alone would pass on stray pixels or one window beside a sliver.
read -r A_X A_Y A_W A_H <<EOF
$(numbers_in "$BOX_A")
EOF
read -r B_X B_Y B_W B_H <<EOF
$(numbers_in "$BOX_B")
EOF
A_RIGHT=$((A_X + A_W))
B_RIGHT=$((B_X + B_W))
WINDOW_W=$(echo "$WINDOW" | cut -dx -f1)
# 45%: the measured half is 800 of 1620 (49.4%), the rest being window
# border. Browser chrome costs height, not width.
LEAST=$((WINDOW_W * 45 / 100))

FAILURE=""
# Check overlap in either order: a right-to-left layout is not a seam
# failure.
if [ "$A_RIGHT" -gt "$B_X" ] && [ "$B_RIGHT" -gt "$A_X" ]; then
  FAILURE="the two windows overlap, so the page is not showing two of them"
elif [ "$A_W" -lt "$LEAST" ] || [ "$B_W" -lt "$LEAST" ]; then
  FAILURE="one of the windows is a sliver rather than half the page (each must \
be at least ${LEAST}px of a ${WINDOW_W}px window)"
fi

echo
echo "in a $WINDOW window:"
echo "  #$COLOR_A across $A_X..$A_RIGHT (${A_W}x${A_H})"
echo "  #$COLOR_B across $B_X..$B_RIGHT (${B_W}x${B_H})"

if [ -z "$FAILURE" ]; then
  echo "PASS: two clients' windows are on one page, side by side, each its own half"
  exit 0
fi

annotate "guard-two-windows: $FAILURE"
exit 1
