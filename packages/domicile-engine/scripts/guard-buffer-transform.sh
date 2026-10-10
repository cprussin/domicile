#!/usr/bin/env bash
# Checks that a client's buffer drawn with wl_surface.set_buffer_transform is
# shown upright.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-buffer-transform.sh /build/chromium/src
#
# `domicile-test-client --buffer-transform 90` draws its buffer on its side:
# #3366CC on the buffer's left half, #CC6633 on its right. A quarter turn puts
# the buffer's left at the window's bottom, so upright, #CC6633 is above
# #3366CC. Shown as drawn, they would sit side by side.
#
# The control draws the same buffer with no turn, so the halves must sit side
# by side: the boxes can tell the two apart.
#
# The client is a `wl_shm` client, so this also covers the compositor's copy
# into its own buffer (`uploads.rs`).
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-buffer-transform: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# `TURNED_COLORS` in packages/domicile-test-client/src/window.rs.
LEFT="3366CC"
RIGHT="CC6633"
APP="${APP:-app-1}"

# NEGATIVE=1 draws the buffer unturned.
NEGATIVE="${NEGATIVE:-0}"
TURN=90
[ "$NEGATIVE" = "1" ] && TURN=normal

# Outlasts the 90s of polling below: the search runs on the submit path.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-buffer-transform-broker}"
PROFILE="${PROFILE:-/tmp/domicile-buffer-transform-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
CLIENT="$ROOT/target/debug/domicile-test-client"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
STARTED=()
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-buffer-transform$WHICH-compositor.log}"
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-buffer-transform$WHICH-engine.log}"
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
  annotate "guard-buffer-transform: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  annotate "guard-buffer-transform: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  annotate "guard-buffer-transform: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
for binary in "$COMPOSITOR" "$CLIENT"; do
  [ -x "$binary" ] || {
    annotate "guard-buffer-transform: no $binary; build it with cargo build -p domicile-compositor"
    exit 1
  }
done

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

"$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-page.html?app=$APP" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-buffer-transform: the page never asked to embed" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-buffer-transform.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$LEFT;$RIGHT" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" \
    --expect-a-page no >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

for _ in $(seq 1 120); do
  grep -q "chrome protocol socket up" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "guard-buffer-transform: the compositor did not start" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
fi

CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

echo "driving domicile-test-client, its buffer turned $TURN"
WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
  "$CLIENT" --title turned --buffer-transform "$TURN" >"$CLI_LOG" 2>&1 &
STARTED+=($!)

# The box the compositor last logged for color $1, as `x y w h`.
box_of() {
  grep -aoE "engine found #FF$1 over \([0-9]+,[0-9]+\) [0-9]+x[0-9]+" "$COMP_LOG" \
    2>/dev/null | tail -1 | grep -oE "\([0-9]+,[0-9]+\) [0-9]+x[0-9]+" |
    grep -oE "[0-9]+" | tr '\n' ' '
}

# `engine settled`: a round found both colors and neither box moved.
SETTLED=0
for _ in $(seq 1 30); do
  grep -aq "engine settled" "$COMP_LOG" 2>/dev/null && { SETTLED=1; break; }
  sleep 3
done

if [ "$SETTLED" != "1" ]; then
  annotate_from "guard-buffer-transform: the compositor never found both halves holding still" "$COMP_LOG"
  grep -aoE "engine (found|has not drawn|could not read).*" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  tail -5 "$CLI_LOG" | sed 's/^/  client: /' >&2
  exit 1
fi

read -r L_X L_Y L_W L_H <<EOF
$(box_of "$LEFT")
EOF
read -r R_X R_Y R_W R_H <<EOF
$(box_of "$RIGHT")
EOF
echo "#$LEFT (the buffer's left): ${L_W}x${L_H} at $L_X,$L_Y"
echo "#$RIGHT (the buffer's right): ${R_W}x${R_H} at $R_X,$R_Y"

BESIDE=0
[ $((L_X + L_W)) -le "$R_X" ] && BESIDE=1
ABOVE=0
[ $((R_Y + R_H)) -le "$L_Y" ] && ABOVE=1

if [ "$NEGATIVE" = "1" ]; then
  if [ "$BESIDE" = "1" ]; then
    echo "PASS: negative control: correct, an unturned buffer's halves sit side by side"
    exit 0
  fi
  annotate "guard-buffer-transform negative control: an unturned buffer's halves" \
    "are not side by side, so the boxes cannot tell a turn apart"
  exit 1
fi

if [ "$ABOVE" = "1" ]; then
  echo "PASS: a buffer drawn on its side is shown upright, its right half on top"
  exit 0
fi
if [ "$BESIDE" = "1" ]; then
  annotate "guard-buffer-transform: the halves sit side by side, so the buffer" \
    "is shown as drawn and its transform was ignored"
  exit 1
fi
annotate "guard-buffer-transform: the halves are neither stacked nor side by" \
  "side, so the buffer was turned the wrong way"
exit 1
