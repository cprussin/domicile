#!/usr/bin/env bash
# Does the chrome cover a desktop that follows Domicile's own window?
#
#   nix develop .#full -c ./scripts/e2e-chrome-fills-a-window.sh
#
# The other half of `e2e-chrome-fills-the-desktop.sh`. There the desktop is the
# config's and the window only shows it; here nothing describes one, so the
# window *is* the desktop — a different path through the compositor
# (`set_output`, reached from `adopt_window_scale`) and the one `nix run
# .#native` takes.
#
# It was untestable for a long time and so untested: `--present` needs a window,
# and without `libxkbcommon-x11.so.0` the compositor dies inside `xkbcommon-dl`
# — in an `expect` that does name the library, but out of a panic, so it reads
# as a compositor crash rather than as a missing dependency. With that library
# and an Xvfb it runs headlessly like anything else.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
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
# The resize below is the second check, and there is no window manager on an
# Xvfb to do it by hand.
command -v xdotool >/dev/null 2>&1 || {
  echo "SKIP: no xdotool, which is what resizes the window here."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-window"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"; CONF="$XDG_RUNTIME_DIR/domicile.toml"
COMP=""; EL=""

# No displays, so the window is still the desktop and this is still the
# undescribed path — but a window that is not 1280x800, which is both winit's
# default *and* Electron's own default window size. At that size a chrome that
# ignored every configure we sent would commit exactly what this asks for, and
# the first check below would pass without the compositor having done anything.
WIN_W=1440
WIN_H=920
cat >"$CONF" <<TOML
[compositor]
nested_size = [$WIN_W, $WIN_H]
TOML

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# A display when there is none. The geometry applies only to a server this
# starts: under `check.sh` there is already one at 1280x800 and `ensure_display`
# takes it untouched. Either is fine — X puts no ceiling on a window's size at
# the root's, so the resize below reaches 1600x1000 on the smaller screen too;
# nothing here reads pixels back off the screen.
ensure_display 1920x1080x24 60 || exit 1

# `WINIT_X11_SCALE_FACTOR=1` pins the output's scale, which is what lets the
# checks below compare two things at all: X reports the window in device pixels
# and the chrome commits in logical units, and those are the same number only
# at scale 1. An Xvfb comes up at 1 anyway — but `Xft.dpi` on an inherited
# display is winit's first choice, so a developer running this on their own
# session would otherwise get halves of two different things and read the
# difference as a bug.
NO_COLOR=1 RUST_LOG=info WINIT_X11_SCALE_FACTOR=1 \
  "$BIN" --no-shell --present --config "$CONF" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `kill`, not `kill -9`, for the chrome and the X server: Electron is a process
# tree and a SIGKILLed one leaves bash reporting "Killed" on stderr as it reaps
# it — the last line of a run that passed, reading like a failure. A TERM lets
# it go down on its own. `wait` after, for the same reason. (A SIGKILLed X
# server also cannot unlink its socket, and the corpse is indistinguishable
# from a display that is up — see `e2e-electron.sh`.)
cleanup() { kill "$COMP" "$EL" ${XVFB:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$ELOG" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

for _ in $(seq 1 200); do grep -q "presenting to a window" "$LOG" && break; sleep 0.05; done
for _ in $(seq 1 200); do
  WID="$(xdotool search --name "Domicile" 2>/dev/null | head -1)"
  [ -n "${WID:-}" ] && break
  sleep 0.05
done
if [ -z "${WID:-}" ]; then
  harness_fault "$COMP" "the compositor could open a window at all" \
    "ERROR: no window named Domicile on this display; the compositor's log" \
    "  ends:" \
    "$(tail -5 "$LOG")"
fi

# Asked of X, and asked again each time rather than read once out of the log.
# The compositor names its window's size when it opens it and never again, so a
# window manager that resizes it after mapping leaves that line stale — the
# chrome would follow the new size and be compared against the old one, and a
# harness that was looking at the wrong number would say the compositor had
# stopped sizing the chrome. What X says is the window's size now.
window_now() {
  xdotool getwindowgeometry --shell "$WID" 2>/dev/null |
    sed -n 's/^WIDTH=\([0-9]*\)/\1/p;s/^HEIGHT=\([0-9]*\)/x\1/p' | tr -d '\n'
}
WINDOW="$(window_now)"

CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
WAYLAND_DISPLAY="$CHROME_DISPLAY" DOMICILE_COMPOSITED=1 \
  DOMICILE_CHROME_SOCKET="$SOCK" \
  electron --no-sandbox --ozone-platform=wayland --disable-gpu \
  "$ROOT/packages/shell-manganese" >"$ELOG" 2>&1 &
EL=$!
still_running() { kill -0 "$EL" 2>/dev/null; }

for _ in $(seq 1 400); do grep -q "the chrome committed a frame" "$LOG" && break; sleep 0.1; done

echo "== the window, and what the chrome committed into it =="
echo "window: $WINDOW"
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG"

committed() {
  sed -n 's/.*the chrome committed a frame width=\([0-9]*\)\.[0-9]* height=\([0-9]*\)\.[0-9]*.*/\1x\2/p' \
    "$LOG" | tail -1
}

if ! still_running; then
  harness_fault "$COMP" "the chrome could stay up" \
    "ERROR: the chrome exited before committing anything; it said:" \
    "$(tail -20 "$ELOG")"
elif [ -z "$(committed)" ]; then
  harness_fault "$COMP" "the chrome could commit a frame at all" \
    "ERROR: the chrome never committed a frame; it said:" \
    "$(tail -20 "$ELOG")"
elif [ "$(committed)" = "$WINDOW" ]; then
  passed "the chrome covers the window that is the desktop"
else
  compositor_verdict "$COMP" \
    "FAIL: the window is $WINDOW and the chrome committed $(committed)." \
    "  With no displays configured the window *is* the desktop, so a chrome" \
    "  that is not its size is a page in the corner of a black screen."
fi

# And when the window changes size under it, which is the whole of what an
# undescribed desktop does: `adopt_window_scale` re-advertises the output and
# reconfigures the chrome, and neither half is any use without the other.
GREW_W=1600
GREW_H=1000
xdotool windowsize "$WID" "$GREW_W" "$GREW_H" >/dev/null 2>&1
RESIZED=$?
# Waited for at X rather than taken on the command's word, and separately from
# waiting on the chrome. A `windowsize` that quietly did nothing leaves the
# chrome exactly where it was, which is indistinguishable from a compositor
# that never passed the new size on — and the check below would report the
# harness's failure as the compositor's.
for _ in $(seq 1 200); do [ "$(window_now)" = "${GREW_W}x${GREW_H}" ] && break; sleep 0.05; done
for _ in $(seq 1 200); do [ "$(committed)" = "${GREW_W}x${GREW_H}" ] && break; sleep 0.1; done

echo
echo "== after the window was resized to ${GREW_W}x${GREW_H} =="
grep -oE "advertising output scale width=[0-9]+ height=[0-9]+ scale=[0-9]+" "$LOG" | tail -1
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG" | tail -1

if ! after 1; then
  harness_fault "$COMP" "the first size could be checked" \
    "ERROR: the size the chrome started at was never established."
elif [ "$RESIZED" != "0" ] || [ "$(window_now)" != "${GREW_W}x${GREW_H}" ]; then
  harness_fault "$COMP" "the window could be resized at all" \
    "ERROR: xdotool exited $RESIZED and X still says the window is" \
    "  $(window_now), not ${GREW_W}x${GREW_H} — so nothing changed under the" \
    "  chrome and there was nothing here for it to follow."
elif ! still_running; then
  harness_fault "$COMP" "the chrome could stay up to be resized" \
    "ERROR: the chrome exited before the window changed under it; it said:" \
    "$(tail -20 "$ELOG")"
elif [ "$(committed)" = "${GREW_W}x${GREW_H}" ]; then
  passed "the chrome followed the window when it was resized"
else
  compositor_verdict "$COMP" \
    "FAIL: the window is now ${GREW_W}x${GREW_H} and the chrome is at $(committed)." \
    "  The desktop follows this window, so a chrome that did not follow it" \
    "  leaves the desktop drawn at the size it started — which is the shape" \
    "  of every report that the chrome stopped filling the screen."
fi

every_check_ran 2
