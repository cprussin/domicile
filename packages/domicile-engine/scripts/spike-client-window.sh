#!/usr/bin/env bash
# Phase 1's deliverable: a real Wayland client's window on the page, and the
# colour it drew coming back out of the display compositor.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/spike-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/spike-client-window.sh /build/chromium/src
#
# From Domicile's full shell, not Chromium's: `engineRuntimeLibs` in flake.nix
# puts Chromium's runtime libraries beside the GL stack, and this needs both —
# the GL stack or no client can hand the compositor a dmabuf at all, Chromium's
# or libdomicile_engine.so will not load.
#
# Every pixel check before this one was the weak form — "the buffer's own zeroed
# content rather than the fallback" — because no harness had a GL context to
# draw known content with. A real client does. kitty is a real GL client and its
# background colour is settable, so the assertion here is the strong one: the
# colour the client drew.
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

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "spike-client-window: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# What the client draws and what the page must therefore show. Not the page's
# background and not a colour any other spike producer submits.
COLOR="${COLOR:-3366CC}"
# The app id the client announces, which the page must ask for by name: the
# broker dispatches embeds on it so that two windows are two surfaces.
CLIENT_APP_ID="${CLIENT_APP_ID:-app-1}"
# NEGATIVE=1 runs the same thing with no client at all. Nothing draws, so the
# page keeps its fallback and the assertion must fail — a green run with no
# control is not evidence.
NEGATIVE="${NEGATIVE:-0}"

# How long the client is given. Longer than everything that can happen before
# and during the poll, because the probe runs on the submit path: a client
# reaped mid-poll stops the measurement, and the guard would then report that
# nothing ever drew.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-client-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-client-window-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
# Collected rather than three variables, because two of the three may never be
# set — a run that fails early, and the negative control, which starts no
# client — and `kill ""` is an error rather than a no-op.
STARTED=()
# Kept rather than discarded: when the page shows its own background instead of
# the client's colour, the compositor's log is the only place that says which
# app id it brokered — and that is now the thing an embed is dispatched on.
# A run and its own negative control are two different measurements, so they
# get two different files. Sharing one meant the control's logs overwrote the
# run's and the diagnostics printed whichever went last — which, when the two
# disagree, is exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-client-window$WHICH-compositor.log}"
# The browser's own log, which used to be thrown away with the tempfile. It is
# where the page's console lines are — which app was embedded, at which
# SurfaceId, and which was refused — and a run where the page showed the wrong
# window cannot be told apart from one where a client never drew without them.
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-client-window$WHICH-engine.log}"
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
}
trap cleanup EXIT

# Into the checkout before anything is looked for: OUT is relative to it, the
# way build.sh and spike.sh treat it.
cd "$CHROMIUM" || {
  annotate "spike-client-window: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  annotate "spike-client-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  annotate "spike-client-window: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "spike-client-window: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
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
  skip "spike-client-window: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

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
  "file://$SCRIPTS/spike-page.html?app=$CLIENT_APP_ID" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "spike-client-window: the page never asked to embed" "$ENGINE_LOG"
  echo "the engine said:" >&2
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
STARTED+=("$COMP")

for _ in $(seq 1 120); do
  grep -q "brokered a frame sink" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "spike-client-window: the compositor did not start" "$COMP_LOG"
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
          -o "background=#$COLOR" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do printf .; sleep 0.2; done' >"$CLI_LOG" 2>&1 &
  STARTED+=($!)
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
  annotate_from "spike-client-window: the engine never drew a client frame" "$COMP_LOG"
  exit 1
fi

echo "the engine drew #$DRAWN; the client drew #$COLOR"
# kitty's background is opaque, so the alpha is FF and the low 24 bits are the
# colour. Compared as a string because the colour is exact: a client's own
# buffer is not resampled on the way to the page.
if [ "${DRAWN#FF}" = "$COLOR" ]; then
  if [ "$NEGATIVE" = "1" ]; then
    annotate "spike-client-window negative control: something drew when nothing should have"
    exit 1
  fi
  echo "PASS: a Wayland client's own window is on the page, in its own colour"
  exit 0
fi
annotate "spike-client-window: the page is showing #$DRAWN, which is not the client's #$COLOR"
exit 1
