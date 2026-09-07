#!/usr/bin/env bash
# A real shell, on the fork, with a real client's window in it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/spike-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/spike-shell.sh /build/chromium/src
#
# WHY THIS EXISTS. Every guard before it drives a page written for the guard:
# spike-page.html and spike-two-windows.html put their canvases where the
# harness can compute a probe point, and name app ids the harness chose. They
# measure the seam. None of them measures the thing the seam is *for* — a shell
# nobody wrote for this, built by its own vite config, joined to the compositor
# by the SDK's own `connectToHost`, mounting `<domicile-app>` elements for
# windows it learns about from the host.
#
# That is three things at once and each has failed on its own: the bridge
# serving the page and the session on one port, the SDK reaching it over a
# WebSocket rather than an Electron preload, and `<domicile-app>` calling
# `embedExternalSurface` for an app id the shell was told about rather than one
# a query string named.
#
# WHAT IT ASSERTS, AND WHY NOT A PIXEL. The shell decides where its windows go.
# A guard that named a coordinate would be asserting shell-simple's CSS, and
# would fail the day someone moved a window — which is not this guard's
# question. So it asks the engine where the client's colour *is*, over the
# whole window, and asserts only that it is somewhere. See
# `domicile_engine_spike_find_colour`.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "spike-shell: no path to chromium/src was given"
  exit 1
fi
SHELL_NAME="${2:-simple}"

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"
SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
[ -d "$SHELL_DIR" ] || {
  annotate "spike-shell: no shell '$SHELL_NAME' — there is no packages/shell-$SHELL_NAME"
  exit 1
}

# Not either spike canvas's fallback and not either two-window colour, so a log
# left over from another guard cannot be mistaken for this one's answer.
COLOR="${COLOR:-19B36B}"

# The negative control's client draws this instead. A control with no client at
# all would prove nothing here: the probe only runs when a client commits, so a
# run with nothing to submit never measures anything and "did not find it"
# would be true of a completely broken pipeline. A client drawing the *wrong*
# colour exercises every step and still fails if the guard matches whatever
# happens to be on screen.
OTHER_COLOR="${OTHER_COLOR:-B3196B}"

# NEGATIVE=1 runs the client with OTHER_COLOR. COLOR must never turn up.
NEGATIVE="${NEGATIVE:-0}"

# How long a client is given. Longer than everything that can happen before and
# during the poll — two waits for a sink at 60s each, then 90s of polling —
# because the search runs on the submit path, so a client reaped mid-poll stops
# the measurement and the guard reports "it never settled", which points at the
# wrong thing entirely.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-300}"

OUT="${OUT:-out/Domicile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
BROKER="${BROKER:-/tmp/domicile-shell-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-profile}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

BRIDGE_LOG=$(mktemp)
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
LOG_COPY="${LOG_COPY:-/tmp/domicile-shell$WHICH-compositor.log}"
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-shell$WHICH-engine.log}"
BRIDGE_LOG_COPY="${BRIDGE_LOG_COPY:-/tmp/domicile-shell$WHICH-bridge.log}"
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  cp "$BRIDGE_LOG" "$BRIDGE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$BRIDGE_LOG" "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "spike-shell: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "spike-shell: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "spike-shell: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "spike-shell: no kitty to draw with, and no nix to fetch one"
  exit 77
fi
command -v bun >/dev/null || {
  skip "spike-shell: no bun, and the shell's page is built with its own vite config"
  exit 77
}

# The shell's page, built the way the shell builds it. Nothing here is a second
# way to build a shell: this is the same `vite.renderer.config.ts`
# electron-forge runs, which is what makes a pass mean anything about a shell
# someone writes.
#
# Two generated things have to exist first, and neither is in the checkout.
#
# `styled-system/` is gitignored and made by the package's own `prepare`
# (panda codegen); the nix node_modules derivation installs with
# `--ignore-scripts`, so a fresh runner has the imports and not the files
# behind them.
#
# And the workspace packages the shell imports are published from `dist/`:
# `@domicile/chrome-sdk`'s exports map every entry point to `./dist/*.js`, so
# on a checkout where nothing has been built, `@domicile/chrome-sdk/bridge`
# does not resolve and the page builds without the SDK in it. That is what
# this guard failed on three times — a developer's machine has `dist/` from
# some earlier build and never sees it.
#
# `^...` is turbo for "this package's dependencies, not this package": the
# shell's own `build` is electron-forge packaging and is not wanted here.
#
# Kept, not discarded. Every other failure in this file prints what it read;
# swallowing this one leaves "the shell's page did not build" as the whole
# account of a build that had plenty to say.
echo "building $SHELL_NAME's page"
BUILD_LOG=$(mktemp)
SHELL_PKG="@domicile/shell-$SHELL_NAME"
if ! (cd "$ROOT" &&
        bun install --frozen-lockfile &&
        bun run turbo build --filter="$SHELL_PKG^..." &&
        cd "$SHELL_DIR" &&
        bun run prepare &&
        bunx vite build --config vite.renderer.config.ts) >"$BUILD_LOG" 2>&1; then
  annotate_from "spike-shell: $SHELL_NAME's page did not build" "$BUILD_LOG"
  echo "the shell's page did not build. It said:" >&2
  tail -40 "$BUILD_LOG" >&2
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"
PAGE_DIR="$SHELL_DIR/.vite/renderer/main_window"
[ -f "$PAGE_DIR/index.html" ] || {
  annotate "spike-shell: $SHELL_NAME built no index.html in $PAGE_DIR"
  exit 1
}

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-shell.sock"
rm -f "$BROKER" "$COMP_SOCK" "$COMP_SOCK.session"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# 1. The bridge, first, because chrome needs a URL and the page has no way to
#    open a unix socket. It tolerates a compositor that does not exist yet,
#    which is the whole reason it can go first.
#
# The reach budget is raised well past its default because the gap this has to
# cover is the browser starting: the page loads, its session opens, and the
# compositor does not exist until chrome has created its broker socket, which
# on a debug build on a loaded runner is minutes. A session that gave up in
# between would leave the page with a dead transport and the guard would report
# that the shell never joined, which is not the thing it guards.
DOMICILE_SOCKET="$COMP_SOCK" DOMICILE_ROOT="$PAGE_DIR" \
DOMICILE_REACH_MS="${DOMICILE_REACH_MS:-600000}" \
  bun "$ROOT/packages/engine-chrome-host/src/main.ts" >"$BRIDGE_LOG" 2>&1 &
STARTED+=($!)

URL=""
for _ in $(seq 1 300); do
  URL="$(sed -n 's/^domicile: serving //p' "$BRIDGE_LOG" | head -1)"
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || {
  annotate_from "spike-shell: the bridge never said where it was serving" "$BRIDGE_LOG"
  echo "the bridge never said where it was serving. It said:" >&2
  cat "$BRIDGE_LOG" >&2
  exit 1
}
echo "the shell is at $URL"

# 2. The engine, on that page. No --enable-logging=stderr flood here beyond
#    what the guards read: the page's own console lines are the record of
#    whether the SDK reached the bridge.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "$URL" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "spike-shell: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  echo "the engine never opened its broker socket. It said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}

# 3. The compositor, as a producer to it, looking for one colour anywhere in
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
  annotate_from "spike-shell: the compositor did not start" "$COMP_LOG"
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
# No fallback: `wayland-1` is as likely to be the compositor this whole guard
# is running inside as it is to be ours, and a client that connected to sway
# instead would draw a window nobody is measuring and fail as "the colour is
# not on screen".
CLIENT_DISPLAY=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$CLIENT_DISPLAY" ] || {
  annotate "spike-shell: the compositor never named its Wayland display"
  echo "the compositor never named its Wayland display. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
}

# The shell has to be joined to the compositor before a window it is told about
# can mean anything: the host announces nothing until a chrome has agreed the
# protocol, so a client started before that is announced to nobody.
#
# This is the first of the three new things this guard measures, and the one
# that fails on its own — it is the SDK reaching the bridge over a WebSocket
# rather than taking a channel an Electron preload injected.
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
  annotate "spike-shell: $SHELL_NAME never joined the compositor, so no window would be announced to it"
  echo "the shell never joined the compositor. Everything each side said:" >&2
  echo "--- the compositor said:" >&2
  grep -aE "chrome|protocol|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
  echo "--- the page said:" >&2
  grep -aE "domicile:|CONSOLE" "$ENGINE_LOG" | tail -12 | cut -c1-200 | sed 's/^/  /' >&2
  echo "--- the bridge said:" >&2
  tail -12 "$BRIDGE_LOG" | sed 's/^/  /' >&2
  exit 1
}
echo "the shell joined the compositor"

DRAWN="$COLOR"
[ "$NEGATIVE" = "1" ] && DRAWN="$OTHER_COLOR"
echo "driving kitty, drawing #$DRAWN"
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
        -o "background=#$DRAWN" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do printf .; sleep 0.2; done' >>"$CLI_LOG" 2>&1 &
STARTED+=($!)

FOUND=""
for _ in $(seq 1 90); do
  FOUND=$(grep -aoE "engine found #[0-9A-F]{8} over .*" "$COMP_LOG" 2>/dev/null |
            tail -1)
  [ -n "$FOUND" ] && break
  kill -0 $COMP 2>/dev/null || break
  sleep 1
done

echo
if [ "$NEGATIVE" = "1" ]; then
  if [ -n "$FOUND" ]; then
    annotate "spike-shell negative control: $FOUND, and the client drew" \
         "#$OTHER_COLOR — the guard is matching something other than the client's pixels"
    exit 1
  fi
  # A control that passes because the whole run fell over proves nothing. The
  # client has to have got as far as a frame the engine took, and the probe has
  # to have run and answered "not yet".
  if ! grep -aq "first frame" "$COMP_LOG" 2>/dev/null; then
    annotate "spike-shell negative control: the engine never took a frame" \
         "from the client, so nothing was measured"
    grep -aE "engine|frame sink|chrome|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
    exit 1
  fi
  # "has not drawn" is only logged when the window was actually captured and
  # searched. A probe that could not read the window at all says something
  # else — see spike_find's three answers — so this cannot go green on a
  # measurement that never happened.
  if ! grep -aq "has not drawn" "$COMP_LOG" 2>/dev/null; then
    annotate "spike-shell negative control: the probe never read the" \
         "window, so nothing was measured"
    grep -aE "engine|frame sink|chrome|ERROR" "$COMP_LOG" | tail -12 | sed 's/^/  /' >&2
    exit 1
  fi
  echo "negative control: correct, the guard does not match a colour no client drew"
  exit 0
fi

if [ -z "$FOUND" ]; then
  if grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null; then
    annotate "spike-shell: the compositor stopped searching before this" \
         "poll ran out, so 'not found' means 'not looked for'. Its budget is" \
         "FIND_FOR in domicile-compositor's main.rs"
    exit 1
  fi
  annotate "spike-shell: the client's window is not on $SHELL_NAME's page"
  echo "what each side said:" >&2
  echo "--- the compositor's last words:" >&2
  grep -aE "engine|frame sink|chrome|buffer|ERROR" "$COMP_LOG" | tail -15 | sed 's/^/  /' >&2
  echo "--- the page's:" >&2
  grep -aE "domicile:|CONSOLE" "$ENGINE_LOG" | tail -15 | cut -c1-200 | sed 's/^/  /' >&2
  exit 1
fi

echo "PASS: $FOUND — a shell nobody wrote for this guard is showing a real"
echo "client's window, on the fork, with no Electron anywhere."
