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
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-chrome-layer"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"

wait_for() { local pat="$1" n="${2:-100}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$LOG" && return 0; sleep 0.1; done; return 1; }
# Wait for *another* occurrence beyond the count already seen.
wait_for_more() { local pat="$1" seen="$2"; for _ in $(seq 1 100); do [ "$(grep -c "$pat" "$LOG")" -gt "$seen" ] && return 0; sleep 0.1; done; return 1; }

RUST_LOG="info" "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
trap 'kill -9 "$COMP" ${APP:-} ${CHROME:-} ${PROBE:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

APP_DISPLAY="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
CHROME_DISPLAY="$(sed -n '/the chrome connects here/s/.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$APP_DISPLAY" ] || [ -z "$CHROME_DISPLAY" ]; then
  echo "FAIL: the compositor did not report both sockets"; cat "$LOG"; exit 1
fi
echo "apps on $APP_DISPLAY, the chrome on $CHROME_DISPLAY"

# The chrome first, because it is the desktop the rest appears on — and because
# a window taking the keyboard only means something once there is a chrome to
# take it from.
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

# Now a window, with something connected to focus it. The probe has to be
# connected before the window appears: the host announces one to the chromes
# that are connected at the time and does not replay it to a late arrival.
DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/focus-probe.ts" >/dev/null 2>&1 &
PROBE=$!
sleep 0.5

WAYLAND_DISPLAY="$APP_DISPLAY" weston-flower >/dev/null 2>&1 &
APP=$!
if wait_for "toplevel mapped"; then
  echo "OK: a client on the app socket became a window on the desktop"
else
  echo "FAIL: a client on the app socket never mapped"; cat "$LOG"; exit 1
fi

# A window taking the keyboard and then going away must not leave the desktop
# deaf. The chrome usually asks for it back, but a client that crashed never
# told it to, so the compositor has to give it back by itself.
if ! wait_for "keyboard focus -> client"; then
  echo "FAIL: the probe never focused the window, so this checks nothing"
  cat "$LOG"; exit 1
fi
BEFORE="$(grep -c "the chrome has the window's keyboard" "$LOG")"
kill -9 "$APP" 2>/dev/null; wait "$APP" 2>/dev/null || true
if wait_for_more "the chrome has the window's keyboard" "$BEFORE"; then
  echo "PASS: the keyboard came back to the chrome when the window went away"
else
  echo "FAIL: the window took the keyboard and kept it after it was gone, so"
  echo "  nothing the user types reaches anything — a desktop that works until"
  echo "  you close a window."
  cat "$LOG"; exit 1
fi

# ...and focusing a window that no longer exists must not take it away again.
# A real chrome loses this race whenever a window closes while its own focus
# message is in flight, and the compositor is what has to survive it.
if wait_for "a window with no surface"; then
  echo "PASS: focusing a window that is gone leaves the keyboard with the chrome"
else
  echo "FAIL: the chrome focused a window with no surface and the compositor"
  echo "  said nothing, so the keyboard went nowhere and stayed there."
  cat "$LOG"; exit 1
fi

# A shortcut the chrome claims has to reach the compositor, which is the only
# thing that sees a key before its client does. Whether it is then taken out of
# the stream needs a window and is unit-tested instead.
if wait_for "the chrome claimed a shortcut"; then
  echo "PASS: a claimed shortcut reached the compositor"
else
  echo "FAIL: the chrome claimed a shortcut and the compositor never heard it,"
  echo "  so every desktop shortcut dies the moment a window takes the keyboard."
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
