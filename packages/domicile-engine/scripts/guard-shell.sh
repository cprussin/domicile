#!/usr/bin/env bash
# Checks that a real shell (shell-simple by default, built by its own vite
# config) embeds a real client's window via `<app>`, on a desktop started by
# `domicile` as a user starts one.
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
# See `docs/architecture/DOMICILE-SCHEME.md` and
# `docs/architecture/THE-DOMICILE-BINARY.md`.
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
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
DOMICILE="$ROOT/target/debug/domicile"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# `domicile` writes the engine's, the compositor's and its own lines to one
# stream. `split_the_run` sorts them into these logs.
RUN_LOG=$(mktemp)
ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
# An empty config home, so the compositor runs on defaults whatever the
# runner's user has configured.
NO_CONFIG=$(mktemp -d)
# The engine profile, under `$XDG_STATE_HOME/domicile`. In `/tmp`, since Chrome
# puts a socket beside the profile and the job's `$TMPDIR` is too deep for the
# 107-byte socket path limit (see `spike.sh`).
STATE=$(mktemp -d /tmp/domicile-shell-state.XXXXXX)
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
RUN_LOG_COPY="${RUN_LOG_COPY:-/tmp/domicile-$WHOSE-run.log}"
# Waits for `domicile`, which stops each component's process group, so the
# next guard does not start beside this one's engine.
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  cp "$RUN_LOG" "$RUN_LOG_COPY" 2>/dev/null
  rm -f "$RUN_LOG" "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
  rm -rf "$NO_CONFIG" "$STATE"
}
trap cleanup EXIT

# Copies `domicile`'s output on stdin to the run log, and each line to the log
# of the process that wrote it:
#
# - the compositor: tracing's lines, which start with a UTC timestamp, and its
#   fatal `domicile-compositor:` line
# - `domicile`: its `domicile:` lines, which stay in the run log only
# - the engine: everything else, which includes `domicile`'s few unprefixed
#   startup lines
#
# Flushes each line, since the guard polls the logs while the run goes on.
split_the_run() {
  awk -v run="$RUN_LOG" -v comp="$COMP_LOG" -v engine="$ENGINE_LOG" '
    { print > run; fflush(run) }
    /^[0-9]+-[0-9]+-[0-9]+T[0-9:.]+Z +(TRACE|DEBUG|INFO|WARN|ERROR) / ||
    /^domicile-compositor: / { print > comp; fflush(comp); next }
    /^domicile: / { next }
    { print > engine; fflush(engine) }
  '
}

# Whether the desktop `domicile` started is still up. `domicile` restarts a
# component that dies, under the same pid, and a restarted engine or
# compositor has lost the shell and the client. That ends the run here, so it
# is not reported later as a missing window.
RESTARTED='^domicile: starting the [a-z]+ again in'
desktop_up() {
  if grep -aqE "$RESTARTED" "$RUN_LOG" 2>/dev/null; then
    annotate_from "guard-shell: domicile restarted a component, so this is no longer the desktop the guard started" \
      "$RUN_LOG"
    exit 1
  fi
  kill -0 "$DOMICILE_PID" 2>/dev/null
}

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
[ -x "$DOMICILE" ] || {
  annotate "guard-shell: no domicile at $DOMICILE; build it with cargo build -p domicile-launch --bin domicile"
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

# The desktop, as `domicile` starts it: the engine on the shell, served from
# `--domicile-shell-root`, then the compositor once the engine's broker socket
# is up. The compositor searches the browser's window for one color.
#
# `DOMICILE_ENGINE_ARGS`:
# - `--log-level=0` keeps the renderer's INFO lines, such as
#   `domicile: embedding`, and the page's console lines, which show whether
#   the shell was handed a desktop. This is the only automated check of that
#   handover.
# - `--no-sandbox` and no component updates, as every guard runs; see
#   `packages/domicile-engine/docs/GUARDS.md`.
DOMICILE_ENGINE="$CHROMIUM/$OUT" \
DOMICILE_COMPOSITOR="$COMPOSITOR" \
DOMICILE_ENGINE_ARGS="--no-sandbox --disable-component-update --log-level=0 --window-size=$WIDTH,$HEIGHT" \
OZONE=wayland \
XDG_CONFIG_HOME="$NO_CONFIG" \
XDG_STATE_HOME="$STATE" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR" \
  "$DOMICILE" "$MODULE" > >(split_the_run) 2>&1 &
DOMICILE_PID=$!
STARTED+=("$DOMICILE_PID")

# `domicile` waits for the broker socket and the compositor's session, and
# says which never turned up. The compositor names its display when it binds
# it. A desktop `domicile` had to restart ends the wait as a failure.
for _ in $(seq 1 360); do
  grep -aq "apps connect here" "$COMP_LOG" 2>/dev/null && break
  grep -aqE "$RESTARTED" "$RUN_LOG" 2>/dev/null && break
  kill -0 "$DOMICILE_PID" 2>/dev/null || break
  sleep 0.5
done
# Only the apps' display. No fallback to `wayland-1`: that may be the
# compositor this guard runs inside, and a client there would draw a window
# nobody measures.
CLIENT_DISPLAY=$(grep -a "apps connect here" "$COMP_LOG" 2>/dev/null |
                   grep -aoE "wayland-[0-9]+" | head -1)
if [ -z "$CLIENT_DISPLAY" ]; then
  if grep -aqE "the engine's broker socket|could not start the engine" "$RUN_LOG" 2>/dev/null; then
    annotate_from "guard-shell: the engine never opened its broker socket" "$RUN_LOG"
  elif [ -s "$COMP_LOG" ]; then
    annotate_from "guard-shell: the compositor never named its Wayland display" "$RUN_LOG"
  else
    annotate_from "guard-shell: the compositor did not start" "$RUN_LOG"
  fi
  echo "the desktop never came up. domicile said:" >&2
  tail -20 "$RUN_LOG" >&2
  exit 1
fi

# Wait for the shell to join. The host announces windows only after a chrome
# agrees the protocol, so a client started earlier is announced to nobody.
# `ControlChannel` sends `hello` when the shell first binds its desktop.
JOINED=0
for _ in $(seq 1 90); do
  if grep -aq "chrome agreed the protocol" "$COMP_LOG" 2>/dev/null; then
    JOINED=1
    break
  fi
  desktop_up || break
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
  desktop_up || break
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
GONE=0
for _ in $(seq 1 "$LOOKS"); do
  FOUND=$(grep -aoE "engine found #[0-9A-F]{8} over .*" "$COMP_LOG" 2>/dev/null |
            tail -1)
  [ -n "$FOUND" ] && break
  desktop_up || { GONE=1; break; }
  sleep 1
  WAITED=$((WAITED + 1))
done

# A compositor that exits ends `domicile` without a restart, so the window's
# absence is the desktop's death. Name it, with what `domicile` said last.
if [ -z "$FOUND" ] && [ "$GONE" = "1" ]; then
  annotate_from "guard-shell: the desktop exited while the guard looked for the client's window" \
    "$RUN_LOG"
  echo "the desktop exited. domicile's last words:" >&2
  tail -40 "$RUN_LOG" | cut -c1-300 | sed 's/^/  /' >&2
  exit 1
fi

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
  # A control that passes because the run failed proves nothing. The engine
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
