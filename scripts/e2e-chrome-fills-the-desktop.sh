#!/usr/bin/env bash
# Does the chrome actually cover the desktop it is drawn over?
#
#   nix develop .#full -c ./scripts/e2e-chrome-fills-the-desktop.sh
#
# The chrome is the desktop: `present` draws it at the size it committed rather
# than stretched over the output, deliberately, so a chrome that has not taken
# its configure yet shows as a gap it has not filled instead of a picture
# quietly scaled to fit. That honesty has a price — the compositor has to
# *tell* it the right size, and the chrome has to take it — and when either
# half slips the desktop is a page in the corner of a black screen.
#
# Nothing covered this. `e2e-electron.sh` runs a real chrome, but over the
# chrome *protocol* socket — the copy path, where the window is the host's and
# `size-to-desktop` sets it. This is the other path: the chrome is a Wayland
# client of ours, its size is a configure we send, and no check drove it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

command -v electron >/dev/null 2>&1 || {
  echo "SKIP: no electron, which is the chrome this drives."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-fills"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"; CONF="$XDG_RUNTIME_DIR/domicile.toml"
COMP=""; EL=""

# A desktop that is not any default, so a chrome sized by anything other than
# this config is visibly not the desktop's size.
WIDTH=1600
HEIGHT=900
cat >"$CONF" <<TOML
[[output.displays]]
name = "only"
size = [$WIDTH, $HEIGHT]
TOML

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# NO_COLOR because the fields below are read back out of this log, and
# tracing writes SGR escapes *between* the field name and its value — a
# pattern for `display="..."` matches nothing in a coloured one.
NO_COLOR=1 RUST_LOG=info "$BIN" --no-shell --config "$CONF" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `kill`, not `kill -9`, for the chrome: Electron is a process tree and a
# SIGKILLed one leaves bash reporting "Killed" on stderr as it reaps it — the
# last line of a run that passed, reading like a failure. A TERM lets it go
# down on its own, and `wait` after reaps it quietly.
cleanup() { kill "$COMP" "$EL" 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$ELOG" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

# Which display the chrome connects on is the compositor's to say: a client on
# the app socket is an app, and `is_chrome_surface` is what tells them apart.
for _ in $(seq 1 100); do grep -q "the chrome connects here" "$LOG" && break; sleep 0.05; done
CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  harness_fault "$COMP" "the compositor could name its chrome display" \
    "ERROR: the compositor never said which display the chrome connects on;" \
    "  its log begins:" \
    "$(head -5 "$LOG")"
fi

# As a Wayland client of ours, which is what `--ozone-platform=wayland` and
# that display make it — not over the chrome protocol socket, which is the
# copy path `e2e-electron.sh` already drives.
# `DOMICILE_CHROME_SOCKET` as well as the display: the chrome is two
# connections, and they are not the same socket. The Wayland one is what makes
# it a client of ours; the protocol one is where the desktop is described, and
# a chrome that cannot open it says so and exits — leaving a compositor that
# looks like it never sized anything.
WAYLAND_DISPLAY="$CHROME_DISPLAY" DOMICILE_COMPOSITED=1 \
  DOMICILE_CHROME_SOCKET="$SOCK" \
  electron --no-sandbox --ozone-platform=wayland --disable-gpu \
  "$ROOT/packages/shell-manganese" >"$ELOG" 2>&1 &
EL=$!

# Alive before anything below is read as a verdict. A chrome that died after
# one frame commits nothing more, and every check after that reports a
# compositor that stopped sizing it — which is a harness fault wearing a
# compositor's clothes, and is exactly what this script did before the socket
# above was passed.
still_running() {
  kill -0 "$EL" 2>/dev/null
}

# The line that says what the desktop is actually made of.
for _ in $(seq 1 400); do grep -q "the chrome committed a frame" "$LOG" && break; sleep 0.1; done

echo "== what the chrome committed =="
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG" || echo "(nothing)"

# The latest, not the first: a client may draw once at a size of its own before
# it has taken a configure, and the question here is what it settled at — the
# desktop has not changed yet, so nothing later can be a different answer.
# `e2e-chrome-fills-a-window.sh` reads the same line the same way.
COMMITTED="$(sed -n 's/.*the chrome committed a frame.*width=\([0-9]*\).*height=\([0-9]*\).*/\1x\2/p' "$LOG" | tail -1)"
if ! still_running; then
  harness_fault "$COMP" "the chrome could stay up" \
    "ERROR: the chrome exited before it committed anything; it said:" \
    "$(tail -20 "$ELOG")"
elif [ -z "$COMMITTED" ]; then
  harness_fault "$COMP" "the chrome could commit a frame at all" \
    "ERROR: the chrome never committed a frame, so its size was never" \
    "  established; electron said:" \
    "$(tail -20 "$ELOG")"
elif [ "$COMMITTED" = "${WIDTH}x${HEIGHT}" ]; then
  passed "the chrome committed at the desktop's own size"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome committed ${COMMITTED}, and the desktop is ${WIDTH}x${HEIGHT}" \
    "  \`present\` draws the chrome at the size it committed, so a chrome" \
    "  smaller than the desktop is a page in the corner of a black screen" \
    "  and one larger is a desktop with its edges off the output."
fi

# And when the desktop changes under it. The compositor reconfigures the chrome
# on a reload — but a configure is a request until the client answers it, and
# what `present` draws is the size it *committed*. A desktop that grew while
# the chrome stayed where it was is a page in the corner of a black screen,
# which is the same symptom as never having been sized at all and a different
# cause.
# Grown by gaining a *display*, so this covers the other thing the chrome has
# to get right about a desktop: it spans the bounding box of every screen, not
# one of them. A chrome sized to a single display on a two-display desktop is
# the same picture-in-the-corner as one that never grew.
GREW_W=2880
GREW_H=1024
cat >"$CONF" <<TOML
[[output.displays]]
name = "only"
size = [1600, 900]

[[output.displays]]
name = "second"
position = [1600, 0]
size = [1280, 1024]
TOML

for _ in $(seq 1 400); do
  grep -q "width=${GREW_W}\.0 height=${GREW_H}\.0" "$LOG" && break
  sleep 0.1
done

echo
echo "== every size the chrome has committed =="
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG"

if ! after 1; then
  harness_fault "$COMP" "the first size could be checked" \
    "ERROR: the size the chrome started at was never established."
elif ! still_running; then
  harness_fault "$COMP" "the chrome could stay up to be resized" \
    "ERROR: the chrome exited before the desktop changed under it, so" \
    "  nothing here is about whether it would have grown; it said:" \
    "$(tail -20 "$ELOG")"
elif grep -q "width=${GREW_W}\.0 height=${GREW_H}\.0" "$LOG"; then
  passed "the chrome grew to span the desktop's second display"
else
  compositor_verdict "$COMP" \
    "FAIL: the desktop grew to ${GREW_W}x${GREW_H} — the box two displays" \
    "  make up — and the chrome did not follow it." \
    "  It is still at the size it first committed, and \`present\` draws it" \
    "  there — so the desktop is a page in the corner of a black screen." \
    "  The compositor reconfigures the chrome on a reload — but only if it" \
    "  saw one: a watcher that would not start is logged and run past, so" \
    "  read the line above before blaming the configure." \
    "$(grep -E "reloaded|not watching the config" "$LOG" | tail -1)"
fi

every_check_ran 2
