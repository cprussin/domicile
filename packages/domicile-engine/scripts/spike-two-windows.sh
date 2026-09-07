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
# control below is built to catch: with one client running, that client's
# window must cover its own half of the page and not the whole of it.
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

# NEGATIVE=1 runs one client instead of two. That client must fill its own
# half and no more — a broker that dispatches on nothing gives both canvases
# the same surface, and with only one client running that shows as one colour
# across the whole page. It is the failure a two-client run cannot tell apart
# from success.
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

cd "$CHROMIUM" || {
  echo "::error::spike-two-windows: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  echo "::error::spike-two-windows: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  echo "::error::spike-two-windows: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  echo "::error::spike-two-windows: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
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
  echo "::error::spike-two-windows: the page never asked to embed"
  echo "the engine said:" >&2
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
  echo "::error::spike-two-windows: the compositor did not start"
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
          # Prints, rather than sitting idle. The probe runs on the submit
          # path — it is called when a client commits a frame the engine
          # takes — so a client that stops drawing stops the measurement
          # dead, and a guard waiting for a box to hold still would then be
          # measuring the client's idleness. kitty redraws for its cursor
          # blink and gives up on that after about fifteen seconds; a
          # character every fifth of a second keeps it committing for as
          # long as the guard is watching.
          #
          # The dots are foreground pixels and the box is the background
          # colour's extent, so they cost nothing the measurement cares
          # about.
          sh -c 'while :; do printf .; sleep 0.2; done' >>"$CLI_LOG" 2>&1 &
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
  echo "::error::spike-two-windows: no frame sink was ever brokered for $app"
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
  # The geometry only. `grep -o` on the whole line would hand the caller the
  # colour too, and `#FF3366CC` contains the digit run `3366` — which is what
  # the first version of this did, so its comparison was a function of the
  # colour strings rather than of where anything was drawn. Two boxes covering
  # the identical region passed it.
  grep -aoE "engine found #FF$1 over \([0-9]+,[0-9]+\) [0-9]+x[0-9]+" "$COMP_LOG" \
    2>/dev/null | tail -1 | grep -oE "\([0-9]+,[0-9]+\) [0-9]+x[0-9]+"
}

# How big the window the boxes are in is, so a box can be compared against it
# rather than against a number this script made up.
window_size() {
  grep -aoE "of the browser's [0-9]+x[0-9]+ window" "$COMP_LOG" 2>/dev/null |
    tail -1 | grep -oE "[0-9]+x[0-9]+"
}

# `(x,y) WxH` -> x y w h, space separated. Only ever given the geometry.
numbers_in() {
  echo "$1" | grep -oE "[0-9]+" | tr '\n' ' '
}

# Poll until each box has been the SAME across two separate MEASUREMENTS.
#
# Not until it is merely non-empty. The compositor writes a box down when it
# moves, so the first one it writes is the window mid-paint — narrower than it
# will be — and the assertions below are about width. Reading that would fail a
# working seam as "a sliver", and would let the negative control pass a client
# that covers the whole page by catching it before it had.
#
# Three seconds between looks, not one, and that is the whole reason the
# interval is written down: the compositor searches every two seconds
# (`FIND_EVERY` in main.rs), so two looks a second apart can both land inside
# one measurement and read the same line twice. Two looks three seconds apart
# straddle two.
#
# The other half is the client, which is why it prints: the search runs on the
# submit path, so a client that stops drawing freezes the box and "it has not
# changed" stops being a statement about the page.
POLL_EVERY=3
# Past the page's own patience for an embed (EMBED_DEADLINE_MS, 20s in
# spike-two-windows.html), so a mis-dispatched second canvas that embeds late
# has turned up before the negative control concludes it never will.
LEAST_LOOKS=8
PREV_A=""
PREV_B=""
BOX_A=""
BOX_B=""
LOOKS=0
STEADY=0
for _ in $(seq 1 30); do
  PREV_A="$BOX_A"
  PREV_B="$BOX_B"
  BOX_A=$(box_of "$COLOR_A")
  BOX_B=$(box_of "$COLOR_B")
  LOOKS=$((LOOKS + 1))
  STEADY_A=0
  [ -n "$BOX_A" ] && [ "$BOX_A" = "$PREV_A" ] && STEADY_A=1
  if [ "$NEGATIVE" = "1" ]; then
    # The one client's box has to hold still, and the other colour has to have
    # had its chance to turn up: "it is not there" said after one look is not a
    # measurement.
    if [ "$STEADY_A" = "1" ] && [ "$LOOKS" -ge "$LEAST_LOOKS" ]; then
      STEADY=1
      break
    fi
  elif [ "$STEADY_A" = "1" ] && [ -n "$BOX_B" ] && [ "$BOX_B" = "$PREV_B" ]; then
    STEADY=1
    break
  fi
  sleep "$POLL_EVERY"
done

# Never holding still is its own answer, and it is not "the boxes are wrong".
# Falling through into the assertions would measure an unsettled reading and
# report whatever it happened to catch.
if [ "$STEADY" != "1" ]; then
  echo "::error::spike-two-windows: no box ever held still across two" \
       "measurements, so nothing here was measured. The client may have" \
       "stopped drawing, which stops the probe: it runs on the submit path."
  echo "the last thing each colour was seen at:" >&2
  echo "  #$COLOR_A: ${BOX_A:-nowhere}" >&2
  echo "  #$COLOR_B: ${BOX_B:-nowhere}" >&2
  exit 1
fi

echo
echo "#$COLOR_A: ${BOX_A:-nowhere in the window}"
echo "#$COLOR_B: ${BOX_B:-nowhere in the window}"
echo "everything the probe said:"
# In the order they were written, not sorted: a box appears again each time it
# moves, and watching one settle is what these lines are for.
grep -aoE "engine (found|has not drawn|could not read the window at all looking for) #[0-9A-F]{8}.*" \
  "$COMP_LOG" 2>/dev/null | sed 's/^/  /'

# A search that stopped is not a search that found nothing, and reporting the
# first as the second is how a slow runner becomes a wrong diagnosis.
if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
  echo "::error::spike-two-windows: the compositor stopped searching before" \
       "this poll ran out, so 'not found' here means 'not looked for'"
  exit 1
fi

# `box_of` matches a prefix of the line that `window_size` reads the end of,
# so a half-flushed line can satisfy one and not the other. Checked rather than
# reasoned about: an empty WINDOW makes both thresholds zero, which turns the
# negative control into a lie and the sliver check into a no-op.
WINDOW=$(window_size)
if [ -z "$BOX_A" ] || [ -z "$WINDOW" ]; then
  echo "::error::spike-two-windows: the first client never reached the page" \
       "at all, so nothing here is about two windows"
  echo "--- the compositor's last words:" >&2
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  exit 1
fi

if [ "$NEGATIVE" = "1" ]; then
  # "The other colour is nowhere" is not the control. Nobody is drawing
  # #$COLOR_B, so it is nowhere whether the broker dispatches correctly or not
  # — the check would pass on the very heuristic it exists to catch.
  #
  # What tells them apart is how much of the page the ONE running client
  # covers. Dispatched on app id, canvas B waits for a producer that never
  # arrives and client A fills its own half. Dispatched on nothing, canvas B
  # embeds client A's surface too and A's colour spans the whole width. So the
  # control is an upper bound on A's box.
  read -r A_X A_Y A_W A_H <<EOF
$(numbers_in "$BOX_A")
EOF
  WINDOW_W=$(echo "$WINDOW" | cut -dx -f1)
  # Both bounds, because the claim has two halves: the one client covers its
  # own half (so the run measured a window rather than a sliver) and not the
  # page (so the other canvas is not showing it too).
  LEAST=$((WINDOW_W * 45 / 100))
  MOST=$((WINDOW_W * 55 / 100))
  echo
  echo "in a $WINDOW window: #$COLOR_A is ${A_W}x${A_H} at $A_X,$A_Y"
  if [ -n "$BOX_B" ]; then
    echo "::error::spike-two-windows negative control: #$COLOR_B is on screen and no client drew it"
    exit 1
  fi
  if [ "$A_W" -lt "$LEAST" ]; then
    echo "::error::spike-two-windows negative control: the one client's window is" \
         "only ${A_W}px of a ${WINDOW_W}px page, so this measured a sliver rather" \
         "than a window and says nothing about dispatch"
    exit 1
  fi
  if [ "$A_W" -ge "$MOST" ]; then
    echo "::error::spike-two-windows negative control: the one client's window" \
         "is ${A_W}px of a ${WINDOW_W}px page, so both canvases are showing it" \
         "and the embed is not dispatched on app id at all"
    exit 1
  fi
  echo "negative control: correct, the one running client fills its own half and" \
       "the other canvas is not showing it"
  exit 0
fi

if [ -z "$BOX_B" ]; then
  echo "::error::spike-two-windows: only one client's window reached the page; #$COLOR_B is nowhere in it"
  exit 1
fi

# Disjoint, and each about half the page.
#
# Disjointness alone is not enough: a stray pixel of each colour in opposite
# corners is disjoint, and so is one window drawn beside a sliver of another.
# The claim is that the page put two windows side by side, so each has to be
# most of its half — and "half" is measured against the window the probe
# reported, not against a number this script chose.
read -r A_X A_Y A_W A_H <<EOF
$(numbers_in "$BOX_A")
EOF
read -r B_X B_Y B_W B_H <<EOF
$(numbers_in "$BOX_B")
EOF
A_RIGHT=$((A_X + A_W))
B_RIGHT=$((B_X + B_W))
WINDOW_W=$(echo "$WINDOW" | cut -dx -f1)
# 45%, not a third. The measured half is 800 of a 1620 capture — 49.4%, the
# missing 0.6% being about ten pixels of window border per side. Browser chrome
# costs height, not width. A third would admit a box a third narrower than the
# truth, which is most of the way to a sliver.
LEAST=$((WINDOW_W * 45 / 100))

FAILURE=""
# Overlap in either order, rather than "A ends before B begins": two disjoint
# windows in the other order is a page laying its canvases out right to left,
# which is not this guard's business and is not a failure of the seam.
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

echo "::error::spike-two-windows: $FAILURE"
exit 1
