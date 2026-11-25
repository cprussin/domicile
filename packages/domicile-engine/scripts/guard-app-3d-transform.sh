#!/usr/bin/env bash
# An `<app>` drawn through a CSS 3D transform: the window's pixels go
# through the transform's perspective as any element's do.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-app-3d-transform.sh /build/chromium/src
#
# The shell (guard-app-3d-transform.js) draws the first window in a 640 by 480
# `<app>` with `transform: perspective(1000px) translateZ(-1000px)`, which
# draws it at half its size: only a 3D transform's perspective does that.
# kitty draws #COLOR. The compositor reads back what viz drew and finds the
# box #COLOR covers. It asserts:
#
#   drawn    the shell put the window in an `<app>`, and logged its width
#   found    #COLOR is on the page
#   shrunk   the box is under three quarters of the `<app>`'s width: the claim
#
# Control: NEGATIVE=1 draws the `<app>` with no transform. Its box must be the
# `<app>`'s whole width, so the claim's narrower box is the transform's work.
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
  annotate "guard-app-3d-transform: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's color, so a stale log cannot match.
COLOR="${COLOR:-CD853F}"

# NEGATIVE=1 draws the `<app>` with no transform. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
[ "$NEGATIVE" = "1" ] && MODE="plain"
CONTROL=0
[ "$NEGATIVE" = "1" ] && CONTROL=1

CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-app-3d-transform-broker}"
PROFILE="${PROFILE:-/tmp/domicile-app-3d-transform-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-app-3d-transform$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-app-3d-transform$WHICH-compositor.log}"
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
  annotate "guard-app-3d-transform: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-app-3d-transform: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-app-3d-transform: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-app-3d-transform: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-app-3d-transform.sock"
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
  --domicile-shell-module=guard-app-3d-transform.js \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-app-3d-transform: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
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
DOMICILE_SPIKE_FIND="$COLOR" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

wait_for_line 360 "chrome agreed the protocol" "$COMP_LOG" || {
  annotate_from "guard-app-3d-transform: the shell never joined the compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# 3. kitty, drawing #COLOR.
DISPLAY_NAME=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$DISPLAY_NAME" ] || {
  annotate_from "guard-app-3d-transform: the compositor never named its Wayland display" "$COMP_LOG"
  exit 1
}
echo "driving kitty on $DISPLAY_NAME, drawing #$COLOR"
NO_COLOR=1 WAYLAND_DISPLAY="$DISPLAY_NAME" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        -o "background=#$COLOR" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do printf .; sleep 0.2; done' >/dev/null 2>&1 &
STARTED+=($!)

# 4. Watch for the window's color. Both runs expect it; the control's budget
#    only caps a run whose window never came. See lib-control-budget.sh.
LOOKS="${LOOKS:-240}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for app-3d-transform "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  found "$COLOR" && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done
# The box settles once the page stops painting.
sleep 2

# The readings.
DRAWN=0
grep -aqE "GUARD drawn app=[^ ]+ width=[0-9]+" "$ENGINE_LOG" 2>/dev/null && DRAWN=1
FOUND=0
found "$COLOR" && FOUND=1
SHRUNK="$(shrunk "$COLOR")"

if [ "$NEGATIVE" != "1" ] && found "$COLOR"; then
  budget_note app-3d-transform "$WAITED"
fi

MEASURED="$MODE $DRAWN $FOUND $SHRUNK"
echo
echo "measured: $MEASURED"
echo "  (mode drawn found shrunk)"

# Which end to blame. `packages/domicile-engine/tests/test-app-3d-transform-guard.sh`
# runs this block directly. MEASURED is "<mode> <drawn> <found> <shrunk>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 1 1 1")
  PASSED="the <app> drew through a CSS 3D transform: its perspective drew \
the window at half its size"
  ;;
"plain 1 1 0")
  PASSED="the control is sharp: with no transform the window covered the \
<app>'s whole width, so the claim's narrower box is the transform's"
  ;;
"claim 0 "* | "plain 0 "*)
  FAILURE="the shell never heard of a window to put in an <app>: the \
compositor announced none"
  ;;
"claim 1 0 "* | "plain 1 0 "*)
  FAILURE="the window's color is not on the page: the <app> drew nothing \
through the transform, or the window never reached the page"
  ;;
"claim 1 1 0")
  FAILURE="THE WINDOW DREW FLAT: it covered the <app>'s whole width through \
a transform that halves it. The <app>'s layer dropped the 3D transform \
(HTMLAppElement, ExternalSurfaceEmbedder) or was drawn without perspective"
  ;;
"claim 1 1 -" | "plain 1 1 -")
  FAILURE="the window's box is neither half nor the whole of the <app>'s \
width, so this run shows nothing about the transform"
  ;;
"plain 1 1 1")
  FAILURE="the window drew narrower than its <app> with no transform: the \
guard is matching something other than the transform's work"
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

annotate_from "guard-app-3d-transform: $FAILURE" "$COMP_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the shell, in order:" >&2
grep -aoE "GUARD .*" "$ENGINE_LOG" 2>/dev/null | head -40 | sed 's/^/  /' >&2
echo "the compositor's last words:" >&2
grep -aE "engine|frame sink|chrome|ERROR|WARN" "$COMP_LOG" | tail -30 | sed 's/^/  /' >&2
exit 1
