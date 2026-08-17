#!/usr/bin/env bash
# Prove the HiDPI chain end to end: a chrome that reports a 2x display makes a
# client draw at 2x, and the frame that comes back says so.
#
#   nix develop .#full -c ./scripts/e2e-hidpi.sh
#
# The chain has four links and each one is asserted separately, because a break
# in any of them looks the same from a screenshot — slightly soft text:
#
#   1. the chrome reports its devicePixelRatio
#   2. the compositor advertises it as the wl_output scale
#   3. a scale-aware client redraws at that scale and says so (set_buffer_scale)
#   4. the frame reaching the chrome carries the scale, and the *logical* size
#      the element is laid out at is the buffer's pixels divided by it
#
# Link 4 is the one worth the most: get it wrong and the pixels are right while
# every pointer coordinate is off by a factor of the scale.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p domicile-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-hidpi"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
CHROME="$(mktemp)"; COMPLOG="$(mktemp)"; CLILOG="$(mktemp)"
MOCK=""; CLI=""

"$BIN" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" $MOCK $CLI 2>/dev/null; rm -f "$CHROME" "$COMPLOG" "$CLILOG"; }
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# The compositor colours its log; these greps read it as plain text.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

fail() { echo "FAIL: $1"; shift; for line in "$@"; do echo "  $line"; done; exit 1; }

# A chrome claiming a 2x display. Everything downstream follows from this one
# number, which is the point: nothing else in the tree is configured for HiDPI.
DOMICILE_CHROME_LISTEN_MS=20000 DOMICILE_CHROME_SOCK="$SOCK" DOMICILE_CHROME_DPR=2 \
  bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$CHROME" 2>&1 &
MOCK=$!
for _ in $(seq 1 200); do plain | grep -q "advertising output scale" && break; sleep 0.05; done

echo "== the scale the compositor advertised =="
plain | grep -oE "advertising output scale scale=[0-9]+" | head -1
if ! plain | grep -q "advertising output scale scale=2"; then
  fail "the compositor did not advertise scale 2 for a 2x chrome" \
       "$(plain | grep -aE 'WARN|ERROR|scale' | tail -5)"
fi
echo "PASS: a 2x chrome makes the compositor advertise output scale 2"

# weston-terminal is scale-aware: it reads wl_output.scale and redraws at it.
# NO_COLOR because libwayland otherwise writes SGR escapes between the interface
# name and the event, and every grep below reads the log as plain text.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 20 weston-terminal >"$CLILOG" 2>&1 &
CLI=$!
for _ in $(seq 1 300); do grep -qc '"app_frame"' "$CHROME" && break; sleep 0.1; done

echo "== what the client did about it =="
grep -oE "wl_surface[#@][0-9]+\.set_buffer_scale\([0-9]+\)" "$CLILOG" | head -1
if ! grep -qE "wl_surface[#@][0-9]+\.set_buffer_scale\(2\)" "$CLILOG"; then
  fail "the client never set a buffer scale of 2" \
       "--- the output events it saw:" \
       "$(grep -aoE 'wl_output[#@][0-9]+\.(scale|done)\([0-9]*\)' "$CLILOG" | sort -u | tr '\n' ' ')" \
       "--- the last thing it did:" \
       "$(grep -aE '^\[[0-9:]+\.[0-9]+\]' "$CLILOG" | cut -c1-140 | tail -5)"
fi
echo "PASS: the client redrew at buffer scale 2"

echo "== the frame that reached the chrome =="
grep -oE '"type":"app_frame","app_id":"[^"]*","width":[0-9]+,"height":[0-9]+,"scale":[0-9]+' "$CHROME" | head -1
if ! grep -q '"type":"app_frame".*"scale":2' "$CHROME"; then
  fail "the frame did not carry scale 2, so the chrome cannot size its canvas" \
       "$(grep -o '"type":"app_frame"[^}]*' "$CHROME" | tail -2)"
fi
echo "PASS: the frame carries the scale it was drawn at"

# The payoff, and the one a screenshot cannot show: the logical size the chrome
# lays out and maps the pointer through is the buffer's pixels divided by the
# scale. Equal to the pixel dimensions would mean every pointer event lands at
# half the position it should.
echo "== logical size vs the buffer's pixels =="
FRAME=$(grep -oE '"type":"app_frame","app_id":"[^"]*","width":[0-9]+,"height":[0-9]+,"scale":[0-9]+' "$CHROME" | tail -1)
RESIZED=$(grep -oE '"type":"app_resized","app_id":"[^"]*","size":\[[0-9.]+,[0-9.]+\]' "$CHROME" | tail -1)
echo "  frame:   $FRAME"
echo "  resized: $RESIZED"
PIXEL_W=$(sed 's/.*"width"://; s/,.*//' <<<"$FRAME")
LOGICAL_W=$(sed 's/.*"size":\[//; s/[.,].*//' <<<"$RESIZED")
if [ -z "$PIXEL_W" ] || [ -z "$LOGICAL_W" ]; then
  fail "the chrome never saw both an app_frame and an app_resized" \
       "$(grep -oE '"type":"[a-z_]+"' "$CHROME" | sort | uniq -c | tr '\n' ' ')"
fi
if [ "$LOGICAL_W" -ge "$PIXEL_W" ]; then
  fail "the reported size is the buffer's pixels, not logical units" \
       "buffer width $PIXEL_W, reported width $LOGICAL_W — every pointer" \
       "coordinate would be off by the scale."
fi
echo "PASS: $PIXEL_W device pixels reported as $LOGICAL_W logical units"
