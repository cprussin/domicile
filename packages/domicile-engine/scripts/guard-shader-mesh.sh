#!/usr/bin/env bash
# A mesh shader effect draws an `<app>` through its mesh: viz runs the
# shell's vertex program over a grid and its fragment program on the window's
# pixels, with SkMesh, on Ganesh or Graphite. The arrays the shell sets reach
# the vertex program while the effect's filter animates on the compositor.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shader-mesh.sh /build/chromium/src
#
# The shell (guard-shader-mesh.js) registers `squeeze`, a mesh effect over a
# 4 by 4 grid whose fragment program swaps red and blue, and draws the first
# window in a 640 by 480 `<app>` with `filter: domicile-shader(squeeze)`. It
# animates that filter on the compositor, then sets the effect's `halve`
# array each frame, which tells the vertex program to draw the content at
# half its size. kitty draws #COLOR, so the shaded window is #SWAPPED. It
# asserts:
#
#   registered   `squeeze` compiled
#   rejected     a vertex program with an error rejected with an
#                OperationError carrying the compiler's message
#   drawn        the shell put the window in an `<app>`, and logged its width
#   swapped      #SWAPPED is on the page: the fragment program ran
#   shrunk       its box is under three quarters of the `<app>`'s width: the
#                vertex program placed it, with the arrays set under the
#                running animation
#
# Control: NEGATIVE=1 draws the `<app>` with no filter. #SWAPPED must not turn
# up, and #COLOR must cover the `<app>`'s whole width.
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
  annotate "guard-shader-mesh: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's colors, so a stale log cannot match. SWAPPED is
# COLOR with red and blue swapped, which is what `squeeze` draws.
COLOR="${COLOR:-5F9EA0}"
SWAPPED="${COLOR:4:2}${COLOR:2:2}${COLOR:0:2}"

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
BROKER="${BROKER:-/tmp/domicile-shader-mesh-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shader-mesh-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shader-mesh$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-shader-mesh$WHICH-compositor.log}"
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
  annotate "guard-shader-mesh: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-shader-mesh: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-shader-mesh: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell --inputs-from "$SCRIPTS/../../.." nixpkgs#kitty --command kitty)
else
  skip "guard-shader-mesh: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-shader-mesh.sock"
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
  --domicile-shell-module=guard-shader-mesh.js \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-shader-mesh: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  last_words "$ENGINE_LOG" >&2
  exit 1
}

# The width of the box the compositor last found #$1 over, or nothing.
found_width() {
  grep -aoE "engine found #FF$1 over \([0-9-]+,[0-9-]+\) [0-9]+x[0-9]+" \
    "$COMP_LOG" 2>/dev/null | tail -1 | sed -E 's/.* ([0-9]+)x[0-9]+$/\1/'
}

# The `<app>`'s untransformed width in device pixels, as the shell logged it.
app_width() {
  grep -aoE "GUARD drawn app=[^ ]+ width=[0-9]+" "$ENGINE_LOG" 2>/dev/null |
    tail -1 | sed -E 's/.*width=//'
}

# 1 when #$1 was found over less than three quarters of the `<app>`'s width,
# 0 when over nine tenths of it or more, and - when neither or not found.
shrunk() {
  local found app
  found="$(found_width "$1")"
  app="$(app_width)"
  if [ -z "$found" ] || [ -z "$app" ] || [ "$app" -eq 0 ]; then
    echo "-"
  elif [ $((found * 4)) -lt $((app * 3)) ]; then
    echo 1
  elif [ $((found * 10)) -ge $((app * 9)) ]; then
    echo 0
  else
    echo "-"
  fi
}

# 2. The compositor, searching the page for the colors.
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
  annotate_from "guard-shader-mesh: the shell never joined the compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# 3. kitty, drawing #COLOR.
DISPLAY_NAME=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$DISPLAY_NAME" ] || {
  annotate_from "guard-shader-mesh: the compositor never named its Wayland display" "$COMP_LOG"
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
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for shader-mesh "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  found "$SWAPPED" && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done
if [ "$NEGATIVE" = "1" ]; then
  # The box settles once the page stops painting.
  sleep 2
else
  # The shell halves the window from its 30th frame under the animation, and
  # the probe searches every 2s, so wait for that line and then for the box
  # to shrink across a few searches.
  wait_for_line 120 "GUARD halving under a running animation" "$ENGINE_LOG"
  for _ in $(seq 1 "${SHRINK_LOOKS:-12}"); do
    [ "$(shrunk "$SWAPPED")" = "1" ] && break
    kill -0 "$COMP" 2>/dev/null || break
    sleep 1
  done
fi

# The readings.
REGISTERED=0
grep -aqF "GUARD registered squeeze" "$ENGINE_LOG" 2>/dev/null && REGISTERED=1
# The compiler's message is not empty, so the quoted message is not "".
REJECTED=0
grep -aqE 'GUARD rejected broken OperationError "[^"]' "$ENGINE_LOG" 2>/dev/null && REJECTED=1
DRAWN=0
grep -aqE "GUARD drawn app=[^ ]+ width=[0-9]+" "$ENGINE_LOG" 2>/dev/null && DRAWN=1
if [ "$NEGATIVE" = "1" ]; then
  SHRUNK="$(shrunk "$COLOR")"
else
  SHRUNK="$(shrunk "$SWAPPED")"
fi
SWAPPED_FOUND=0
found "$SWAPPED" && SWAPPED_FOUND=1

if [ "$NEGATIVE" != "1" ] && found "$SWAPPED"; then
  budget_note shader-mesh "$WAITED"
fi

MEASURED="$MODE $REGISTERED $REJECTED $DRAWN $SWAPPED_FOUND $SHRUNK"
echo
echo "measured: $MEASURED"
echo "  (mode registered rejected drawn swapped shrunk)"

# Which end to blame. `packages/domicile-engine/tests/test-shader-mesh-guard.sh`
# runs this block directly. MEASURED is "<mode> <registered> <rejected> <drawn> <swapped> <shrunk>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 1 1 1 1 1")
  PASSED="viz drew the <app> through the shell's mesh: its vertex program \
halved the window and its fragment program swapped its colors"
  ;;
"plain 1 1 1 0 0")
  PASSED="the control is sharp: with no filter the window covered the \
<app>'s width in its own color, so the claim's find is the mesh's"
  ;;
"claim 0 "* | "plain 0 "*)
  FAILURE="the mesh effect never registered: viz refused its programs \
(CompileShaderEffect, CompileMesh: SkMeshSpecification::Make). The shell's \
line says why"
  ;;
"claim 1 0 "* | "plain 1 0 "*)
  FAILURE="a vertex program that does not compile did not reject with an \
OperationError carrying the compiler's message (CompileMesh)"
  ;;
"claim 1 1 0 "* | "plain 1 1 0 "*)
  FAILURE="the shell never heard of a window to put in an <app>: the \
compositor announced none"
  ;;
"claim 1 1 1 0 "*)
  FAILURE="THE MESH DREW NOTHING: the swapped color is not on the page. \
SkiaRenderer skipped the mesh (FindMeshEffect, DrawMeshEffect: SkMesh::Make \
logs why it made none), or the pass was bypassed with no texture to sample \
(SurfaceAggregator's generate_mipmap)"
  ;;
"claim 1 1 1 1 0")
  FAILURE="the fragment program ran but the window kept its size: the halve \
array the shell set with updateShaderEffect under the running filter \
animation never reached viz (a 'GUARD refused halve' line says why it threw; \
no 'GUARD halving' line means it never started; else \
ComputeAnimatedFilterChange, DirectlyUpdateShaderArrays, \
EffectTree::OnFilterAnimated), or the vertex program's positions were not \
used (DrawMeshEffect's matrix)"
  ;;
"claim 1 1 1 1 -")
  FAILURE="the swapped window is neither half nor the whole of the <app>'s \
width, so this run shows nothing about the vertex program"
  ;;
"plain 1 1 1 1 "*)
  FAILURE="the swapped color turned up with no filter: the guard is \
matching something other than the mesh's work"
  ;;
"plain 1 1 1 0 1" | "plain 1 1 1 0 -")
  FAILURE="the control's window did not cover its <app>, so it shows \
nothing about the mesh"
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

annotate_from "guard-shader-mesh: $FAILURE" "$COMP_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the shell, in order:" >&2
grep -aoE "GUARD .*" "$ENGINE_LOG" 2>/dev/null | head -40 | sed 's/^/  /' >&2
echo "the compositor's last words:" >&2
grep -aE "engine|frame sink|chrome|ERROR|WARN" "$COMP_LOG" | tail -30 | sed 's/^/  /' >&2
exit 1
