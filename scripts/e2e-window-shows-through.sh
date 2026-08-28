#!/usr/bin/env bash
# Do a client's own pixels actually reach the screen?
#
#   nix develop .#full -c ./scripts/e2e-window-shows-through.sh
#
# A `<domicile-app>` element is a *hole* in the page. The compositor draws the
# client's buffer there and composites the chrome over the top, so a window is
# visible only because the page painted nothing where it is. Put a background
# on anything behind that hole and the window is gone — every window, if the
# element spans the desktop, and nothing on screen says why.
#
# Nothing in this repo checked that. A full-page backdrop written while the
# bands were going in would have hidden every window on the desktop, and every
# check in the tree passed on it; it was caught by reading, which is not a
# check. This is the check: the compositor looks through each window's hole at
# the frame the chrome actually committed and says what it found there.
#
# It has to be a real engine. The rule is about a computed background on an
# ancestor, and the test DOM has no cascade — a unit test for it passes
# whatever the page says, which is exactly why the one written at the time was
# deleted rather than shipped. So this runs the shell as a *Wayland client of
# ours*, the same way `e2e-bands.sh` does, with a real client's window on the
# stage under it.
#
# **To falsify it, put a background on an element** — `main { background: ... }`
# in the shell's `global.css` is the shape the real one had. Not on `html`:
# `electron-chrome-host` injects `html, body { background: transparent
# !important }` into a composited chrome, so an `html` rule never applies and
# is not a defect. A run against one looks like this check failing to fire when
# it should, and it is the check being right.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing.
build_test_client || exit 1
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

if ! command -v electron >/dev/null 2>&1; then
  # Newest by version, not by store hash — see `check.sh`.
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || {
    echo "SKIP: no electron, and the rule under test is about what a real\n  engine computes for a background."
    exit 77
  }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

export XDG_RUNTIME_DIR="/tmp/domicile-rt-shows"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"; CLOG="$(mktemp)"
COMP=""; EL=""; APP=""

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# NO_COLOR because the fields below are read back out of this log, and tracing
# writes SGR escapes *between* a field name and its value — a pattern for
# `band=0` matches the `0` in an escape sequence first.
NO_COLOR=1 RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `kill`, not `kill -9`, for the chrome: Electron is a process tree and a
# SIGKILLed one leaves bash reporting "Killed" on stderr as it reaps it — the
# last line of a run that passed, reading like a failure.
cleanup() { kill "$COMP" "$EL" "$APP" 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$ELOG" "$CLOG"; }
trap cleanup EXIT

# Sourced for all of it, not only the bails: the verdicts below are decisions
# in sequence, every arm ends in a helper that exits or in `passed`, and
# `every_check_ran` catches a bail that turned into a no-op. See
# `packages/e2e-harness/src/verdicts.ts`.
. "$ROOT/scripts/lib/harness.sh"

# Wait until $2 appears in file $1. $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ] && break; sleep 0.05; done

# Which display the chrome connects on is the compositor's to say: a client on
# the app socket is an app, and the socket is what tells them apart.
for _ in $(seq 1 100); do grep -q "the chrome connects here" "$LOG" && break; sleep 0.05; done
CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  harness_fault "$COMP" "the compositor could name its chrome display" \
    "ERROR: the compositor never said which display the chrome connects on;" \
    "  its log begins:" \
    "$(head -5 "$LOG")"
fi

# The session document, not the socket: `publish()` is the last statement in
# the compositor's `main()`, so the socket exists long before the document and
# a `cat` on the socket's appearance hands the chrome an empty session.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  harness_fault "$COMP" "the compositor could publish a session" \
    "ERROR: the compositor never published a session, so nothing can be" \
    "  started against it."
fi
# `composited` overridden, which is the one thing the published session cannot
# say here: the compositor reports whether *it* got a window (`--present`) and
# this one deliberately has none — but the chrome below is still a Wayland
# client of ours whose surface we composite, so it must be transparent rather
# than paint a background over the apps. Asserted rather than assumed, because
# the substitution depends on the exact spelling `to_string_pretty` produces
# and a serializer change would make it a silent no-op.
COMPOSITED_SESSION="$(sed 's/"composited": false/"composited": true/' "$SOCK.session")"
case "$COMPOSITED_SESSION" in
  *'"composited": true'*) ;;
  *) harness_fault "$COMP" "the session could be marked composited" \
       "ERROR: could not mark the session composited; the document reads:" \
       "$(cat "$SOCK.session")" ;;
esac

WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  DOMICILE_SESSION="$COMPOSITED_SESSION" \
  electron --no-sandbox --ozone-platform=wayland --disable-gpu \
  "$ROOT/packages/shell-manganese/.vite/build/main.js" >"$ELOG" 2>&1 &
EL=$!

if wait_for "$LOG" "the chrome committed a frame" 400; then
  passed "the shell is a Wayland client of ours, committing frames we composite"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome never committed a frame we could read, so there is no" \
    "  page to look through a window's hole at. Its own output:" \
    "$(tail -12 "$ELOG")"
fi

# A real client on the app socket, which is what the shell mounts a portal for.
# `--trace` so its own view is in the log beside the compositor's when this
# fails for a reason on the client's side.
WAYLAND_DISPLAY=wayland-1 timeout 60 "$TEST_CLIENT" --title shows --trace \
  >"$CLOG" 2>&1 &
APP=$!

if ! after 1; then
  harness_fault "$COMP" "the first check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif ! wait_for "$LOG" '"type":"place_portal"' 300; then
  compositor_verdict "$COMP" \
    "FAIL: a real client mapped a window and the shell never placed a portal" \
    "  for it, so the compositor does not know where that window is and has" \
    "  nowhere to look. What the client saw:" \
    "$(tail -8 "$CLOG")" \
    "  what the chrome said:" \
    "$(tail -8 "$ELOG")"
else
  passed "a real client's window is on the stage, placed by the shell"
fi

# What the compositor found looking through the hole. `opaque=false` is the
# window showing through; `opaque=true` is a page painting over it.
looked() { grep -o "the chrome over a window.*" "$LOG" | tail -1; }
for _ in $(seq 1 200); do [ -n "$(looked)" ] && break; sleep 0.2; done

if ! after 2; then
  harness_fault "$COMP" "the second check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ -z "$(looked)" ]; then
  compositor_verdict "$COMP" \
    "FAIL: the compositor never looked through the window's hole, so nothing" \
    "  here says a client's pixels reach the screen. It looks once per window," \
    "  on a whole-page chrome frame — a chrome being asked for bands commits" \
    "  one depth at a time and none of those is the page." \
    "  what the chrome said:" \
    "$(tail -8 "$ELOG")"
elif ! printf '%s' "$(looked)" | grep -q "opaque=false"; then
  compositor_verdict "$COMP" \
    "FAIL: the chrome is opaque where the window is, so that window is not on" \
    "  screen at all: something behind its <domicile-app> element is painting" \
    "  a background, and it fills in the hole the client shows through." \
    "  the reading: $(looked)"
else
  passed "the chrome is transparent where the window is, so the client shows through"
fi

every_check_ran 3
