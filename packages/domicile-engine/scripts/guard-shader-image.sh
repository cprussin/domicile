#!/usr/bin/env bash
# A shader effect samples an image the shell gave it: viz makes the image
# from the shell's pixels and hands it to the effect as a child shader.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shader-image.sh /build/chromium/src
#
# The shell (guard-shader-image.js) registers `stamp` with a 2 by 2 image of
# #IMAGE as `uniform shader stamp`, which it draws wherever the content is
# opaque, and draws the first window in an `<app>` with
# `filter: domicile-shader(stamp)`. kitty draws #COLOR. It asserts:
#
#   registered   `stamp` compiled with its image
#   rejected     an image the program does not sample rejected with an
#                OperationError
#   drawn        the shell put the window in an `<app>`
#   stamped      #IMAGE is on the page: the claim
#
# Control: NEGATIVE=1 draws the `<app>` with no filter. #IMAGE must not turn
# up, and #COLOR must.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shader-image: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's colors, so a stale log cannot match.
COLOR="${COLOR:-6B8E23}"
IMAGE="${IMAGE:-8A2BE2}"

# NEGATIVE=1 draws the `<app>` with no filter. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
[ "$NEGATIVE" = "1" ] && MODE="plain"
CONTROL=0
[ "$NEGATIVE" = "1" ] && CONTROL=1

CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-shader-image-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shader-image-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shader-image$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-shader-image$WHICH-compositor.log}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shader-image: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-shader-image: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-shader-image: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell --inputs-from "$SCRIPTS/../../.." nixpkgs#kitty --command kitty)
else
  skip "guard-shader-image: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-shader-image.sock"
fresh_broker
rm -f "$COMP_SOCK" "$COMP_SOCK.session" "$ENGINE_LOG" "$COMP_LOG"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -aqF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# Whether the compositor found #$1 on the page.
found() {
  grep -aqE "engine found #FF$1 over" "$COMP_LOG" 2>/dev/null
}

# 1. The engine, on the shell.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app="domicile://shell/?control=$CONTROL" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module=guard-shader-image.js \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-shader-image: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  last_words "$ENGINE_LOG" >&2
  exit 1
}

# 2. The compositor, searching the page for the colors.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR;$IMAGE" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

wait_for_line 360 "chrome agreed the protocol" "$COMP_LOG" || {
  annotate_from "guard-shader-image: the shell never joined the compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# 3. kitty, drawing #COLOR.
DISPLAY_NAME=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$DISPLAY_NAME" ] || {
  annotate_from "guard-shader-image: the compositor never named its Wayland display" "$COMP_LOG"
  exit 1
}
echo "driving kitty on $DISPLAY_NAME, drawing #$COLOR"
NO_COLOR=1 WAYLAND_DISPLAY="$DISPLAY_NAME" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        -o "background=#$COLOR" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do printf .; sleep 0.2; done' >/dev/null 2>&1 &
STARTED+=($!)

# 4. Watch for the image's color. The control expects an absence, so it waits
#    a multiple of the guard's time. See lib-control-budget.sh.
LOOKS="${LOOKS:-240}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for shader-image "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  found "$IMAGE" && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done
# The box settles once the page stops painting.
sleep 2

# The readings.
REGISTERED=0
grep -aqF "GUARD registered stamp" "$ENGINE_LOG" 2>/dev/null && REGISTERED=1
REJECTED=0
grep -aqE 'GUARD rejected unsampled OperationError "[^"]' "$ENGINE_LOG" 2>/dev/null && REJECTED=1
DRAWN=0
grep -aqE "GUARD drawn app=[^ ]+ width=[0-9]+" "$ENGINE_LOG" 2>/dev/null && DRAWN=1
STAMPED=0
found "$IMAGE" && STAMPED=1
PLAIN=0
found "$COLOR" && PLAIN=1

if [ "$NEGATIVE" != "1" ] && found "$IMAGE"; then
  budget_note shader-image "$WAITED"
fi

MEASURED="$MODE $REGISTERED $REJECTED $DRAWN $STAMPED $PLAIN"
echo
echo "measured: $MEASURED"
echo "  (mode registered rejected drawn stamped plain)"

# Which end to blame. `packages/domicile-engine/tests/test-shader-image-guard.sh`
# runs this block directly. MEASURED is "<mode> <registered> <rejected> <drawn> <stamped> <plain>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 1 1 1 1 "*)
  PASSED="viz drew the shell's image through its effect over the <app>"
  ;;
"plain 1 1 1 0 1")
  PASSED="the control is sharp: with no filter the window drew its own \
color and the image's never turned up, so the claim's find is the effect's"
  ;;
"claim 0 "* | "plain 0 "*)
  FAILURE="the effect never registered with its image: the shell's pixels \
did not reach viz (DomicileHost::registerShaderEffect, ShaderEffectsService), \
or viz refused them (MakeImages, CheckChildren). The shell's line says why"
  ;;
"claim 1 0 "* | "plain 1 0 "*)
  FAILURE="an image the program does not sample did not reject with an \
OperationError (CheckChildren)"
  ;;
"claim 1 1 0 "* | "plain 1 1 0 "*)
  FAILURE="the shell never heard of a window to put in an <app>: the \
compositor announced none"
  ;;
"claim 1 1 1 0 1")
  FAILURE="THE WINDOW DREW WITHOUT THE IMAGE: the effect's child was not \
the image. The aggregator did not attach the inputs (ResolveShaderEffects), \
or the image filter did not bind them (Shade)"
  ;;
"claim 1 1 1 0 0")
  FAILURE="neither the window's color nor the image's is on the page: the \
effect drew nothing, or the window never reached the page"
  ;;
"plain 1 1 1 1 "*)
  FAILURE="the image's color turned up with no filter: the guard is \
matching something other than the effect's work"
  ;;
"plain 1 1 1 0 0")
  FAILURE="the control's window never reached the page, so it shows \
nothing about the effect"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the run did not get as far as reading, or ran a mode this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-shader-image: $FAILURE" "$COMP_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the shell, in order:" >&2
grep -aoE "GUARD .*" "$ENGINE_LOG" 2>/dev/null | head -40 | sed 's/^/  /' >&2
echo "the compositor's last words:" >&2
grep -aE "engine|frame sink|chrome|ERROR|WARN" "$COMP_LOG" | tail -30 | sed 's/^/  /' >&2
exit 1
