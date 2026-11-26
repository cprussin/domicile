#!/usr/bin/env bash
# A shell's shader effect draws over an `<app>`: viz runs the shell's SkSL on
# the window's pixels, and SkSL that does not compile rejects with the
# compiler's error.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shader-effect.sh /build/chromium/src
#
# The shell (guard-shader-effect.js) registers `swap`, which swaps red and
# blue, and draws the first window in an `<app>` with
# `filter: domicile-shader(swap, 1)`. kitty draws #COLOR, so the shaded window
# is #SWAPPED. The compositor reads back what viz drew and searches it for
# both. It asserts:
#
#   registered   `swap` compiled and takes one number
#   rejected     SkSL with a syntax error rejected with an OperationError
#                carrying the compiler's message
#   drawn        the shell put the window in an `<app>`
#   swapped      #SWAPPED is on the page: the claim
#   plain        #COLOR is on the page, as the window drew it
#
# Control: NEGATIVE=1 draws the `<app>` with no filter. #SWAPPED must not turn
# up, so the claim's find is the effect's work and not something else on the
# page; and #COLOR must, so the window did reach the page.
#
# Under Wayland with the GPU, the path a desk takes: SkiaRenderer runs the
# effect on Ganesh or Graphite, whichever the card's build uses.
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
  annotate "guard-shader-effect: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's colors, so a stale log cannot match. SWAPPED is COLOR
# with red and blue swapped, which is what `swap` draws.
COLOR="${COLOR:-2E8B57}"
SWAPPED="${COLOR:4:2}${COLOR:2:2}${COLOR:0:2}"

# NEGATIVE=1 draws the `<app>` with no filter. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="shade"
[ "$NEGATIVE" = "1" ] && MODE="plain"
CONTROL=0
[ "$NEGATIVE" = "1" ] && CONTROL=1

CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-shader-effect-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shader-effect-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shader-effect$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-shader-effect$WHICH-compositor.log}"
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
  annotate "guard-shader-effect: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-shader-effect: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-shader-effect: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell --inputs-from "$SCRIPTS/../../.." nixpkgs#kitty --command kitty)
else
  skip "guard-shader-effect: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-shader-effect.sock"
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
  --domicile-shell-module=guard-shader-effect.js \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-shader-effect: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  last_words "$ENGINE_LOG" >&2
  exit 1
}

# 2. The compositor, searching the page for both colors.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR;$SWAPPED" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

wait_for_line 360 "chrome agreed the protocol" "$COMP_LOG" || {
  annotate_from "guard-shader-effect: the shell never joined the compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# 3. kitty, drawing #COLOR.
DISPLAY_NAME=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$DISPLAY_NAME" ] || {
  annotate_from "guard-shader-effect: the compositor never named its Wayland display" "$COMP_LOG"
  exit 1
}
echo "driving kitty on $DISPLAY_NAME, drawing #$COLOR"
NO_COLOR=1 WAYLAND_DISPLAY="$DISPLAY_NAME" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        -o "background=#$COLOR" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do printf .; sleep 0.2; done' >/dev/null 2>&1 &
STARTED+=($!)

# 4. Watch for the swapped color. The control expects an absence, so it waits
#    a multiple of the guard's time. See lib-control-budget.sh.
LOOKS="${LOOKS:-240}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for shader-effect "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  found "$SWAPPED" && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done

# The readings.
REGISTERED=0
grep -aqF "GUARD registered swap takes=1" "$ENGINE_LOG" 2>/dev/null && REGISTERED=1
# The compiler's message is not empty, so the quoted message is not "".
REJECTED=0
grep -aqE 'GUARD rejected broken OperationError "[^"]' "$ENGINE_LOG" 2>/dev/null && REJECTED=1
DRAWN=0
grep -aqF "GUARD drawn app=" "$ENGINE_LOG" 2>/dev/null && DRAWN=1
SWAPPED_FOUND=0
found "$SWAPPED" && SWAPPED_FOUND=1
PLAIN=0
found "$COLOR" && PLAIN=1

if [ "$NEGATIVE" != "1" ] && [ "$SWAPPED_FOUND" = "1" ]; then
  budget_note shader-effect "$WAITED"
fi

MEASURED="$MODE $REGISTERED $REJECTED $DRAWN $SWAPPED_FOUND $PLAIN"
echo
echo "measured: $MEASURED"
echo "  (mode registered rejected drawn swapped plain)"

# Which end to blame. `packages/domicile-engine/tests/test-shader-effect-guard.sh`
# runs this block directly. MEASURED is "<mode> <registered> <rejected>
# <drawn> <swapped> <plain>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"shade 1 1 1 1 "*)
  PASSED="viz ran the shell's shader effect over its <app>, and SkSL that \
does not compile rejected with the compiler's error"
  ;;
"plain 1 1 1 0 1")
  PASSED="the control is sharp: with no filter the window drew its own \
color and the swapped one never turned up, so the claim's find is the effect's"
  ;;
"shade 0 "* | "plain 0 "*)
  FAILURE="the shell's effect never registered: the browser refused the \
document (BindDomicileShaderEffects is for domicile://shell/ only), or viz \
refused the SkSL (CompileShaderEffect). The shell's line says which"
  ;;
"shade 1 0 "* | "plain 1 0 "*)
  FAILURE="SkSL that does not compile did not reject with an OperationError \
carrying the compiler's message (DomicileHost::ShaderEffectRegistered, \
CompileShaderEffect)"
  ;;
"shade 1 1 0 "* | "plain 1 1 0 "*)
  FAILURE="the shell never heard of a window to put in an <app>: the \
compositor announced none"
  ;;
"shade 1 1 1 0 1")
  FAILURE="THE WINDOW DREW UNSHADED: the filter never reached viz with its \
program. Blink dropped domicile-shader() (DomicileShaderEffects::Resolve, \
FilterEffectBuilder), or the aggregator did not find the effect under the \
<app>'s frame sink (ResolveShaderEffects)"
  ;;
"shade 1 1 1 0 0")
  FAILURE="neither the window's color nor its swap is on the page: the \
effect drew nothing (BuildShadedImageFilter), or the window never reached \
the page"
  ;;
"plain 1 1 1 1 "*)
  FAILURE="the swapped color turned up with no filter: the guard is \
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

annotate_from "guard-shader-effect: $FAILURE" "$COMP_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the shell, in order:" >&2
grep -aoE "GUARD .*" "$ENGINE_LOG" 2>/dev/null | head -40 | sed 's/^/  /' >&2
echo "the compositor's last words:" >&2
grep -aE "engine|frame sink|chrome|ERROR|WARN" "$COMP_LOG" | tail -30 | sed 's/^/  /' >&2
exit 1
