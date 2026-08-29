#!/usr/bin/env bash
# The desktop on a display that is not 1x, which is the only place two whole
# classes of fault are visible.
#
#   nix develop .#full -c ./scripts/e2e-a-dense-display.sh
#
# The draw path *is* covered — `e2e-chrome-fills-a-window.sh` and
# `e2e-window-follows-the-desktop.sh` both pass `--present`, so the compositor
# opens a window and `present()` runs. What neither does is run it at a density
# other than 1, and the first of them pins `WINIT_X11_SCALE_FACTOR=1` on
# purpose: it is a check about the desktop's *size*, and a fixed scale is what
# lets it read one number instead of two.
#
# So nothing had ever drawn a desktop where a CSS pixel and a display pixel are
# different sizes, and at 1x they never are. Two faults lived in that gap at
# once and shipped:
#
#   - The desktop was sized by the *rounded* output scale rather than by the
#     display's own ratio, so a 1.5x screen became a desktop two thirds its
#     size with every CSS pixel in it drawn a third too large.
#   - `wp_viewporter` was advertised and not honoured. Chromium reads that
#     global as permission to stop calling `wl_surface.set_buffer_scale` and to
#     put its logical size in `wp_viewport.set_destination` instead, which
#     nothing read — so the chrome's surface became twice its true size, and
#     with it every portal and pointer coordinate. It is honoured now, and the
#     reading below is written to hold either way round: *which* of the two
#     forms Chromium picks is its business, and it picks by what is advertised.
#     What has to agree is the size.
#
# Both are one comparison: what the compositor says the desktop is, against
# what the chrome's surface actually measures. They have to be the same number.
# The scale is deliberately *fractional* (1.5, so `wl_output.scale` rounds up
# to 2) because that is the case where the two ways of expressing a size stop
# agreeing. At a whole ratio a broken compositor and a working one are
# indistinguishable, which is exactly how both of these shipped.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

if ! command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || { echo "SKIP: no electron to run the chrome with"; exit 77; }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

export XDG_RUNTIME_DIR="/tmp/domicile-rt-dense"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
LOG="$(mktemp)"
COMP=""; XVFB=""

wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }
said() { sed 's/\x1b\[[0-9;]*m//g' "$LOG"; }

# A display of a size this check chooses, which is why the caller's is *not*
# taken. `ensure_display` inherits one when it finds one, and inherits its
# geometry with it — right for every other script and wrong here, because every
# number below is arithmetic on 1920x1200 and `check.sh` makes its own display
# at a size of its own. Unsetting first is how a caller says it needs a
# particular screen rather than any screen, and it keeps the verdict, the
# `-displayfd` handshake and the cleanup that go with it.
#
# It also has to come *before* the desktop starts: the compositor reads
# `DISPLAY` once, and one started without a screen presents to nothing however
# long it runs afterwards.
unset DISPLAY
ensure_display 1920x1200x24 60 || exit 1

# The density. Xvfb has no notion of one, so winit is told — which is what a
# host compositor would say on a real dense screen, and the only number this
# check needs from outside.
export WINIT_X11_SCALE_FACTOR=1.5
cleanup() { kill "$COMP" ${XVFB:-} 2>/dev/null; pkill -P "$COMP" 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

# The whole desktop, started the way a user starts it: the shell's own stub,
# which starts the compositor under itself with `--present` and then runs the
# chrome as a *Wayland client of it*. That relationship is the point. Starting
# the two separately, as `e2e-electron.sh` does, puts the chrome on the host's
# display and its pixels through the socket — the copy path, where the
# compositor draws nothing and neither fault below can appear.
( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese >/dev/null 2>&1 ) \
  || { echo "the shell failed to build"; exit 1; }

# Chromium's sandbox helper is not setuid in a store build, and this runs as
# root in a container often enough that the default is the useful one — the
# same default `run-native.sh` takes, and for the same reason.
DOMICILE_ELECTRON_ARGS="${DOMICILE_ELECTRON_ARGS---no-sandbox}"
export DOMICILE_ELECTRON_ARGS
DOMICILE_COMPOSITOR="$BIN"; export DOMICILE_COMPOSITOR
NO_COLOR=1 RUST_LOG="info,domicile_compositor=debug" \
  "$ROOT/packages/shell-manganese/bin/manganese" >"$LOG" 2>&1 &
COMP=$!

echo "== the compositor has a window to draw in =="
# `--present` is opt-in and the shell's launcher is what asks for it here.
# Asserted rather than assumed: without a window `present()` returns before it
# draws anything, and every reading below would be about a desktop that was
# never composited.
if ! wait_for "$LOG" "presenting to a window" 300; then
  echo "FAIL: the compositor never opened a window, so it never drew anything."
  echo "  Every check below reports on the draw path; without a window there"
  echo "  is no draw path to report on. \$DISPLAY was '$DISPLAY'."
  said | tail -12 | cut -c1-200 | sed 's/^/  /'
  exit 1
fi
if ! said | grep -q "presenting to a window.*w: 1920.*h: 1200"; then
  echo "FAIL: the window is not the size this display was made at."
  echo "  Everything below is arithmetic on that size and means nothing if it"
  echo "  is not the 1920x1200 asked for."
  said | grep "presenting to a window" | cut -c1-200 | sed 's/^/  /'
  exit 1
fi
echo "PASS: presenting to a 1920x1200 window"

echo
echo "== the desktop is as big as the display, not as its rounded scale =="
# 1920 / 1.5, and *not* 1920 / 2. `wl_output.scale` is a whole number and
# rounds 1.5 up so buffers stay sharp; the desktop's size is how much room
# there is, which the display settles and no protocol constrains.
if ! wait_for "$LOG" "advertising output scale" 150; then
  echo "FAIL: the compositor never advertised an output scale for its window."
  exit 1
fi
ADVERTISED="$(said | grep "advertising output scale" | tail -1)"
if ! echo "$ADVERTISED" | grep -q "width=1280 height=800 scale=2"; then
  echo "FAIL: the desktop is not 1280x800 at scale 2."
  echo "  A 1920x1200 window on a 1.5x display is 1280x800 of room, advertised"
  echo "  at the rounded scale 2 so clients overdraw and stay sharp. Dividing"
  echo "  the window by 2 instead gives 960x600 — a desktop two thirds the"
  echo "  size of the screen it covers, with the whole chrome drawn a third"
  echo "  too large."
  echo "  --- what it said:"
  echo "  $ADVERTISED"
  exit 1
fi
echo "PASS: 1280x800 at scale 2"

echo
echo "== and the chrome's surface is that desktop, measured =="
if ! wait_for "$LOG" "the chrome committed a frame" 600; then
  echo "FAIL: the chrome never committed a frame, so there is nothing to measure."
  said | grep -aiE "electron|chrome|gpu|egl" | cut -c1-200 | tail -12 | sed 's/^/  /'
  exit 1
fi
FRAME="$(said | grep "the chrome committed a frame" | tail -1)"
# The logical size, which is the buffer divided by the scale the client set —
# so this one line carries both halves of what the second fault broke.
# The size, and deliberately not the buffer scale beside it. Chromium has two
# ways to state a surface's size and picks by what the compositor advertises:
# `set_buffer_scale(2)` on a 1280x800 buffer, or `set_destination(1280, 800)`
# on a 2560x1600 one. Both are the same surface and both are correct; a check
# that pinned one of them would go red on a protocol being *added*, which is
# what happened to the first version of this line.
if ! echo "$FRAME" | grep -qE "width=1280(\.0)? height=800(\.0)?"; then
  echo "FAIL: the chrome's surface is not the desktop it was given."
  echo "  It was told 1280x800 and its surface has to measure that, however it"
  echo "  says so. 2560x1600 is the buffer read as though nothing else spoke"
  echo "  for it — the viewport's destination ignored — and every portal and"
  echo "  pointer coordinate doubles with it."
  echo "  --- what it said:"
  echo "  $FRAME"
  exit 1
fi
echo "PASS: the chrome's surface measures 1280x800"
echo
echo "So a CSS pixel in the chrome is 1.5 display pixels, which is what the"
echo "display is, and the desktop is drawn the size of the screen it covers."
