#!/usr/bin/env bash
# The compositor tells the chrome apart from the apps by which socket a client
# arrived on.
#
#   nix develop .#full -c ./scripts/e2e-chrome-layer.sh
#
# Two identical clients, one on each socket. The one on the app socket becomes a
# window on the desktop; the one on the chrome socket becomes the desktop. If
# they were not told apart the chrome would mount an <app> element for itself,
# inside itself, and the recursion would be the least of it.
#
# Headless on purpose: what is under test is the classification, which happens
# before anything is drawn. Whether the chrome's pixels land over the apps needs
# a window and lives in scripts/run-native.sh.
set -u

# tracing colours its own output and the checks below read it.
export NO_COLOR=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
[ -x "$BIN" ] || { echo "build first: nix develop .#full -c cargo build -p domicile-compositor"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-chrome-layer"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"

wait_for() { local pat="$1" n="${2:-100}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$LOG" && return 0; sleep 0.1; done; return 1; }

RUST_LOG="info" "$BIN" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
trap 'kill -9 "$COMP" ${APP:-} ${CHROME:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

APP_DISPLAY="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
CHROME_DISPLAY="$(sed -n '/the chrome connects here/s/.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$APP_DISPLAY" ] || [ -z "$CHROME_DISPLAY" ]; then
  echo "FAIL: the compositor did not report both sockets"; cat "$LOG"; exit 1
fi
echo "apps on $APP_DISPLAY, the chrome on $CHROME_DISPLAY"

WAYLAND_DISPLAY="$APP_DISPLAY" weston-flower >/dev/null 2>&1 &
APP=$!
if wait_for "toplevel mapped"; then
  echo "OK: a client on the app socket became a window on the desktop"
else
  echo "FAIL: a client on the app socket never mapped"; cat "$LOG"; exit 1
fi

WAYLAND_DISPLAY="$CHROME_DISPLAY" weston-flower >/dev/null 2>&1 &
CHROME=$!
if wait_for "the chrome mapped its toplevel"; then
  echo "PASS: a client on the chrome socket became the desktop, not a window on it"
else
  echo "FAIL: the client on the chrome socket was not recognised as the chrome"
  cat "$LOG"; exit 1
fi

# The chrome holds the keyboard until a window is focused, which is how the
# window's input reaches it. It shares the one seat with the apps and they take
# turns: a seat of its own would let both hold a focus at once, but a client
# does not have to bind more than one, and Electron drops the connection when
# there are two.
if wait_for "the chrome has the window's keyboard"; then
  echo "PASS: the chrome took its seat's keyboard focus"
else
  echo "FAIL: the chrome never took keyboard focus, so the window's input has"
  echo "  nowhere to go — the desktop would look hung."
  cat "$LOG"; exit 1
fi

# What the desktop is made of, reported once per shape. The picture cannot be
# checked here — there is no display — but whether the compositor understood
# the buffer can be, and that is what a wrong picture comes down to.
if wait_for "the chrome committed a frame"; then
  echo "PASS: the compositor described the chrome's frame"
  grep "the chrome committed a frame" "$LOG" | head -1
else
  echo "FAIL: the chrome's frame was never described, so it never became a"
  echo "  texture — there would be nothing drawn over the apps."
  cat "$LOG"; exit 1
fi

# One app, not two: the chrome must never have been announced.
MAPPED="$(grep -c "toplevel mapped" "$LOG")"
if [ "$MAPPED" = "1" ]; then
  echo "PASS: exactly one window was announced to the chrome"
else
  echo "FAIL: $MAPPED windows were announced; the chrome was announced as one of them"
  grep "toplevel mapped" "$LOG"
  exit 1
fi
