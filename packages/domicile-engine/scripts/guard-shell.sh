#!/usr/bin/env bash
# Checks that a real shell (shell-simple by default, built by its own vite
# config) embeds a real client's window via `<app>`.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shell.sh /build/chromium/src
#
# It tests three parts, each of which has failed on its own:
#
# - the engine serving the shell over `domicile://` and writing its document
# - the shell reaching the compositor through the desktop handed to `Shell`
# - `<app>` calling `embedExternalSurface` for an app id the host announced
#
# See `docs/architecture/DOMICILE-SCHEME.md`.
#
# Asserts the client's color appears anywhere in the window, not at a
# coordinate, since the shell's CSS decides layout. See
# `domicile_engine_spike_find_color`.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell: no path to chromium/src was given"
  exit 1
fi
SHELL_NAME="${2:-simple}"

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"
SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
[ -d "$SHELL_DIR" ] || {
  annotate "guard-shell: no shell '$SHELL_NAME' — there is no packages/shell-$SHELL_NAME"
  exit 1
}

# Differs from other guards' colors, so a stale log from another guard cannot
# match.
COLOR="${COLOR:-19B36B}"

# The negative control's client draws this. The probe runs only when a client
# commits, so a control with no client at all would pass on a broken pipeline.
OTHER_COLOR="${OTHER_COLOR:-B3196B}"

# NEGATIVE=1 runs the client with OTHER_COLOR. COLOR must never turn up.
NEGATIVE="${NEGATIVE:-0}"

# How long the client lives. It must outlast the 60s embed wait plus 90s of
# polling, because the search runs on the submit path and stops when the
# client exits.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
BROKER="${BROKER:-/tmp/domicile-shell-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-profile}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
STARTED=()
# A run and its negative control write separate logs, so both can be read side
# by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
# Include the shell's name: the diagnostics glob picks logs up by name, and
# runs for different shells must not overwrite each other.
WHOSE="shell-$SHELL_NAME$WHICH"
LOG_COPY="${LOG_COPY:-/tmp/domicile-$WHOSE-compositor.log}"
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-$WHOSE-engine.log}"
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

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-shell: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-shell: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-shell: no kitty to draw with, and no nix to fetch one"
  exit 77
fi
command -v bun >/dev/null || {
  skip "guard-shell: no bun, and the shell's page is built with its own vite config"
  exit 77
}

# Build the page the way the repository does (turbo `build:vite`), so the guard
# tests the page that ships. `build:vite` depends on `^prepare` and `^build`,
# which generate `styled-system/` and the workspace packages' `dist/`; neither
# is in the checkout.
#
# `CI=1` stops turbo's `//#build:install-modules` from running a non-frozen
# `bun install`. A cached turbo run can still restore `bun.lock`, because that
# task declares it an output and `CI` is not in `globalEnv`. That needs fixing
# in `turbo.json`.
#
# Print the build log on failure.
echo "building $SHELL_NAME's page"
BUILD_LOG=$(mktemp)
SHELL_PKG="./packages/shell-$SHELL_NAME"
if ! (cd "$ROOT" &&
        bun install --frozen-lockfile &&
        CI=1 bun run turbo build:vite --filter="$SHELL_PKG") >"$BUILD_LOG" 2>&1; then
  annotate_from "guard-shell: $SHELL_NAME's page did not build" "$BUILD_LOG"
  echo "the shell's page did not build. It said:" >&2
  tail -40 "$BUILD_LOG" >&2
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"
PAGE_DIR="$SHELL_DIR/.vite/renderer/main_window"

# A shell builds to one module, `shell.js` (the name `shellBuild` pins).
# Domicile writes the document, so there is no `index.html`.
MODULE="$PAGE_DIR/shell.js"
if [ ! -f "$MODULE" ]; then
  annotate "guard-shell: $SHELL_NAME built no shell.js in $PAGE_DIR"
  exit 1
fi

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-shell.sock"
rm -f "$BROKER" "$COMP_SOCK" "$COMP_SOCK.session"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# 1. The engine serves the shell from `--domicile-shell-root` and writes the
#    document itself, as `spawn::engine` does.
#
# Start chrome first: the compositor connects to the broker socket chrome
# creates. `ControlChannel` retries while the compositor's socket is missing.

# 2. The engine, on the shell. The page's console lines in the engine log show
#    whether the shell was handed a desktop. This is the only automated check
#    of that handover.
#
#    `--app` hides the tab strip, as `domicile` does, so the guard runs the
#    product's configuration.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$PAGE_DIR" \
  --domicile-shell-module="$(basename "$MODULE")" \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-shell: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  echo "the engine never opened its broker socket. It said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}

# 3. The compositor, as a producer to it, looking for one color anywhere in
#    the browser's window.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

for _ in $(seq 1 120); do
  grep -aq "wayland-[0-9]" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "guard-shell: the compositor did not start" "$COMP_LOG"
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
# No fallback to `wayland-1`: that may be the compositor this guard runs
# inside, and a client there would draw a window nobody measures.
CLIENT_DISPLAY=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$CLIENT_DISPLAY" ] || {
  annotate "guard-shell: the compositor never named its Wayland display"
  echo "the compositor never named its Wayland display. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# Wait for the shell to join. The host announces windows only after a chrome
# agrees the protocol, so a client started earlier is announced to nobody.
# `ControlChannel` sends `hello` when the shell first binds its desktop.
JOINED=0
for _ in $(seq 1 90); do
  if grep -aq "chrome agreed the protocol" "$COMP_LOG" 2>/dev/null; then
    JOINED=1
    break
  fi
  kill -0 $COMP 2>/dev/null || break
  sleep 1
done
[ "$JOINED" = "1" ] || {
  annotate "guard-shell: $SHELL_NAME never joined the compositor, so no window would be announced to it"
  echo "the shell never joined the compositor. Everything each side said:" >&2
  echo "--- the compositor said:" >&2
  grep -aE "chrome|protocol|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  echo "--- the page said:" >&2
  grep -aE "domicile:|CONSOLE" "$ENGINE_LOG" | tail -12 | cut -c1-200 | sed 's/^/  /' >&2
  echo "--- the engine said about the shell:" >&2
  grep -aE "domicile:|shell|ERROR" "$ENGINE_LOG" | tail -12 | cut -c1-200 | sed 's/^/  /' >&2
  exit 1
}
echo "the shell joined the compositor"

DRAWN="$COLOR"
[ "$NEGATIVE" = "1" ] && DRAWN="$OTHER_COLOR"
echo "driving kitty, drawing #$DRAWN"
# Keep the client printing. The probe runs only when a client commits a
# frame, and kitty stops redrawing after its cursor blink times out (~15s).
# The dots are foreground pixels; the probe measures the background color.
NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        -o "background=#$DRAWN" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do printf .; sleep 0.2; done' >>"$CLI_LOG" 2>&1 &
STARTED+=($!)

# Check that the page heard about the client before checking pixels.
# Otherwise "the color is not on screen" cannot tell a misplaced window from a
# page that was never told about the client.
#
# `domicile: embedding` comes from the renderer when a mounted `<app>` calls
# `embedExternalSurface`, so read the engine log, not the page's console.
#
# Also check that the compositor logged `app_appeared`, so a client that never
# mapped is not blamed on the page.
EMBEDDED=0
ANNOUNCED=0
# A shell that lays windows out on a screen (manganese's `OnTheFirstScreen`)
# renders nothing until the host describes a desktop. Track that separately so
# the failure names the desktop, not the announcement.
DESKTOP=0
for _ in $(seq 1 60); do
  grep -aq 'app_appeared' "$COMP_LOG" 2>/dev/null && ANNOUNCED=1
  grep -aqE 'told the chrome about [1-9]' "$COMP_LOG" 2>/dev/null && DESKTOP=1
  if grep -aq 'domicile: embedding' "$ENGINE_LOG" 2>/dev/null; then
    EMBEDDED=1
    break
  fi
  kill -0 $COMP 2>/dev/null || break
  sleep 1
done
# Check once more after the loop, so an announcement logged during the last
# `sleep 1` is not missed.
grep -aq 'app_appeared' "$COMP_LOG" 2>/dev/null && ANNOUNCED=1
grep -aqE 'told the chrome about [1-9]' "$COMP_LOG" 2>/dev/null && DESKTOP=1
if [ "$EMBEDDED" != "1" ]; then
  if [ "$ANNOUNCED" != "1" ]; then
    annotate "guard-shell: no client ever mapped on $CLIENT_DISPLAY, so the" \
         "shell was told about nothing and there was nothing to embed"
  elif [ "$DESKTOP" != "1" ]; then
    annotate "guard-shell: $SHELL_NAME was announced a client and its" \
         "handshake carried no display, so a chrome that lays out on a screen" \
         "had nowhere to put a window. The desktop, not the announcement"
  else
    annotate "guard-shell: $SHELL_NAME was announced a client and never" \
         "embedded it, so the page is not hearing the host"
  fi
  echo "the shell embedded nothing. What each side said:" >&2
  echo "--- the compositor said:" >&2
  grep -aE "app_appeared|brokered|chrome|ERROR" "$COMP_LOG" | tail -12 |
    sed 's/^/  /' >&2
  echo "--- the page said:" >&2
  grep -aE "domicile:|CONSOLE" "$ENGINE_LOG" | tail -12 | cut -c1-200 |
    sed 's/^/  /' >&2
  echo "--- the engine said about the shell:" >&2
  grep -aE "domicile:|shell|ERROR" "$ENGINE_LOG" | tail -12 | cut -c1-200 | sed 's/^/  /' >&2
  echo "--- the client said:" >&2
  tail -12 "$CLI_LOG" | sed 's/^/  /' >&2
  exit 1
fi
echo "the shell embedded the client it was announced"

# How long to watch. The guard stops when the color appears. The control looks
# for an absence, so it always waits its full budget, which is scaled from this
# shell's last guard timing (or 90 without one). See lib-control-budget.sh.
LOOKS="${LOOKS:-90}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for "shell-$SHELL_NAME" "$LOOKS")"

FOUND=""
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  FOUND=$(grep -aoE "engine found #[0-9A-F]{8} over .*" "$COMP_LOG" 2>/dev/null |
            tail -1)
  [ -n "$FOUND" ] && break
  kill -0 $COMP 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done

# Record the timing only when the guard found the color. A run that timed out
# measured nothing.
if [ "$NEGATIVE" != "1" ] && [ -n "$FOUND" ]; then
  budget_note "shell-$SHELL_NAME" "$WAITED"
fi

echo
if [ "$NEGATIVE" = "1" ]; then
  if [ -n "$FOUND" ]; then
    annotate "guard-shell negative control: $FOUND, and the client drew" \
         "#$OTHER_COLOR — the guard is matching something other than the client's pixels"
    exit 1
  fi
  # A control that passes because the run fell over proves nothing. The engine
  # must have taken a frame from the client.
  if ! grep -aq "first frame" "$COMP_LOG" 2>/dev/null; then
    annotate "guard-shell negative control: the engine never took a frame" \
         "from the client, so nothing was measured"
    grep -aE "engine|frame sink|chrome|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
    exit 1
  fi
  # `has not drawn` is logged only after the window was captured and searched.
  # A probe that could not read the window logs something else.
  if ! grep -aq "has not drawn" "$COMP_LOG" 2>/dev/null; then
    annotate "guard-shell negative control: the probe never read the" \
         "window, so nothing was measured"
    grep -aE "engine|frame sink|chrome|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
    exit 1
  fi
  echo "PASS: negative control: correct, the guard does not match a color no client drew"
  exit 0
fi

# `engine found` already implies a first frame, since the probe runs in
# `publish_frame`. This check only names the failure: no frame reached the
# engine, or the window is missing from the page.
#
# It cannot catch the shell's own chrome painting the search color, because the
# engine reports one box over the whole window. `NEGATIVE=1` catches that.
if ! grep -aq "first frame" "$COMP_LOG" 2>/dev/null; then
  annotate "guard-shell: the engine never took a frame from $SHELL_NAME's" \
       "client, so whatever is on the page is not the client's window"
  grep -aE "engine|frame sink|chrome|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  exit 1
fi

if [ -z "$FOUND" ]; then
  if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
    annotate "guard-shell: the compositor stopped searching before this" \
         "poll ran out, so 'not found' means 'not looked for'. Its budget is" \
         "FIND_FOR in domicile-compositor's main.rs"
    exit 1
  fi
  annotate "guard-shell: the client's window is not on $SHELL_NAME's page"
  echo "what each side said:" >&2
  echo "--- the compositor's last words:" >&2
  grep -aE "engine|frame sink|chrome|buffer|ERROR" "$COMP_LOG" | tail -15 | sed 's/^/  /' >&2
  echo "--- the page's:" >&2
  grep -aE "domicile:|CONSOLE" "$ENGINE_LOG" | tail -15 | cut -c1-200 | sed 's/^/  /' >&2
  exit 1
fi

echo "PASS: $FOUND — a shell nobody wrote for this guard is showing a real"
echo "client's window, on the fork, with no Electron anywhere."
