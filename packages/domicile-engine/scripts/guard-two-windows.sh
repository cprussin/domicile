#!/usr/bin/env bash
# Two Wayland clients, two windows, one page — the claim nothing had ever made.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-two-windows.sh /build/chromium/src
#
# From Domicile's full shell, not Chromium's, for the reason
# guard-client-window.sh gives: `engineRuntimeLibs` puts Chromium's runtime
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

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-two-windows: no path to chromium/src was given"
  exit 1
fi

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

# How long a client is given. Longer than everything that can happen after it
# starts — a wait for the second client's sink at 60s, then 90s of polling —
# because the search runs on the submit path, so a client reaped mid-poll stops
# the measurement and the guard reports "it never settled", which points at the
# wrong thing entirely. 420 is that with room, not a number tuned against
# anything else.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

# What the compositor is asked to look for. The negative run does not ask for
# the second colour, and that is what lets it settle: settling means "every
# colour I was asked for was found and none of them moved", so asking for one
# nobody is drawing means never settling, and a guard that cannot wait for a
# settled measurement asserts on whatever it caught mid-paint.
#
# Nothing is lost. "The second colour is nowhere" was never the control —
# nobody draws it either way — and the claim that does the work is how much of
# the page the one running client covers.
FIND_COLOURS="$COLOR_A;$COLOR_B"
[ "$NEGATIVE" = "1" ] && FIND_COLOURS="$COLOR_A"

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

# The compositor, told which colours to look for. No DOMICILE_SPIKE_PROBE:
# this guard names no points, so it needs no coordinate space to name them in,
# and the centre — which on this page is the seam between the two canvases and
# inside neither — is not sampled either.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-two-windows.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$FIND_COLOURS" \
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

# One client at a time, and the second only once the first has been brokered.
# The app ids are the compositor's own, minted in the order windows appear, so
# starting both at once would make which client is app-1 a race — and the page
# named app-1 and app-2 before either existed.
start_client() {
  local colour="$1"
  echo "driving kitty, drawing #$colour"
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
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$colour" \
          -o initial_window_width=640 -o initial_window_height=480 \
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

# Wait for the COMPOSITOR to say it looked again and nothing had moved.
#
# Not for the log to stop changing, which is what two equal looks measure and
# is not the same thing. A box is written down only when it *moves*, so a log
# that is not changing is equally consistent with a settled page and with a
# search that has stopped — and the search does stop, because it runs on the
# submit path and a client that quietens down takes it with it. Two readings
# of a frozen file agree with each other forever.
#
# So the compositor says it: `engine settled` is logged when a round finds
# every colour it was asked for and none of their boxes moved since the round
# before. That is the two-measurement rule, made where the measurements are,
# and both runs wait for it — which is why the negative run is careful to ask
# only for a colour that exists.
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

# The three ways this can have measured nothing, told apart. Before the
# assertions, because each of them is a different fact from "the boxes are
# wrong" and reporting one as another is what sent the last several runs
# chasing the wrong thing.
#
# The first of them is unreachable at today's numbers — the compositor looks
# for 300s (`FIND_FOR`) and this polls for at most 150 from the first frame —
# and is kept for the day someone lengthens the poll, so that doing so cannot
# quietly turn "we stopped looking" into "it is not there".
if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
  annotate "guard-two-windows: the compositor stopped searching before" \
       "this poll ran out, so 'not found' here means 'not looked for'"
  exit 1
fi
if [ -z "$BOX_A" ]; then
  annotate "guard-two-windows: the first client's colour never appeared" \
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
# Not looked for in the negative run, so saying "nowhere" would read as a
# finding about the page rather than as a fact about what was asked.
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
  echo "negative control: correct, the one running client fills its own half and" \
       "the other canvas is not showing it"
  exit 0
fi

if [ -z "$BOX_B" ]; then
  annotate "guard-two-windows: only one client's window reached the page; #$COLOR_B is nowhere in it"
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

annotate "guard-two-windows: $FAILURE"
exit 1
