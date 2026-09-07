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
# different sizes, and at 1x they never are. The fault that lived in that gap
# and shipped: the desktop was sized by the *rounded* output scale rather than
# by the display's own ratio, so a 1.5x screen became a desktop two thirds its
# size with every CSS pixel in it drawn a third too large.
#
# The scale is deliberately *fractional* (1.5, so `wl_output.scale` rounds up
# to 2) because that is the case where the two ways of expressing a size stop
# agreeing. At a whole ratio a broken compositor and a working one are
# indistinguishable, which is exactly how that shipped.
#
# WHAT THIS NO LONGER COVERS, AND IT IS WORTH SAYING RATHER THAN LEAVING TO BE
# DISCOVERED. There was a second fault here: `wp_viewporter` advertised and not
# honoured. Chromium reads that global as permission to stop calling
# `wl_surface.set_buffer_scale` and to put its logical size in
# `wp_viewport.set_destination` instead, which nothing read — so the chrome's
# surface became twice its true size, and every portal and pointer coordinate
# with it. Only a real Chromium chooses between the two forms, and only by what
# is advertised, so only a real Chromium can catch that half. This drove an
# Electron until Electron was removed from this repository; the chrome here now
# is `domicile-test-client --follow-configure`, which speaks
# `set_buffer_scale` and nothing else. **The viewporter half is uncovered.**
# Covering it needs the fork, and the fork does not composite — it renders, and
# the compositor is a producer to it — so there is no arrangement in which the
# engine is a chrome whose surface this compositor sizes.
#
# What survives is the arithmetic, which is where the fault that shipped was:
# what the compositor says the desktop is, against what the chrome's surface
# actually measures. They have to be the same number.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
# 1, not 77: a client this repo builds and cannot build is a broken tree.
build_test_client || exit 1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-dense"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"
LOG="$(mktemp)"; CLOG="$(mktemp)"
COMP=""; CHROME=""; XVFB=""

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
cleanup() { kill "$COMP" ${CHROME:-} ${XVFB:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$CLOG"; }
trap cleanup EXIT

# The compositor with a window to draw in, which is what `--present` asks for
# and what makes every reading below about the draw path. No configured
# displays, so the window *is* the desktop and its density is the display's —
# which is the whole subject here.
NO_COLOR=1 RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --present --chrome-socket "$SOCK" >"$LOG" 2>&1 &
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
# The chrome, on the display the compositor named for one: a client is a chrome
# or an app by which socket it arrived on, and `--follow-configure` is the one
# behaviour that makes this client a chrome — it takes the size it is
# configured at rather than keeping the one it opened at.
#
# Started only now, after the advertisement above. Not for the ordering's sake:
# the compositor advertises to whoever is bound, so a chrome that connected
# first would be told the same thing. It is that a run which failed above has
# nothing for a chrome to be sized *to*, and starting one anyway would put a
# second failure under the first.
CHROME_DISPLAY="$(said | sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  echo "FAIL: the compositor never said which display the chrome connects on."
  said | tail -12 | cut -c1-200 | sed 's/^/  /'
  exit 1
fi
WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  "$TEST_CLIENT" --title chrome --follow-configure >"$CLOG" 2>&1 &
CHROME=$!

if ! wait_for "$LOG" "the chrome committed a frame" 600; then
  echo "FAIL: the chrome never committed a frame, so there is nothing to measure."
  echo "  it said:"
  tail -12 "$CLOG" | sed 's/^/  /'
  said | grep -aiE "chrome|gpu|egl" | cut -c1-200 | tail -12 | sed 's/^/  /'
  exit 1
fi
FRAME="$(said | grep "the chrome committed a frame" | tail -1)"
# The logical size, which is the buffer divided by the scale the client set.
# Read as a size rather than as a buffer and a scale, deliberately: a surface
# can state its size either way — `set_buffer_scale(2)` on a 1280x800 buffer,
# or `set_destination(1280, 800)` on a 2560x1600 one — and both are the same
# surface. A check that pinned one of them would go red on a protocol being
# *added*, which is what happened to the first version of this line. This
# client only ever says it the first way; the header explains what that costs.
if ! echo "$FRAME" | grep -qE "width=1280(\.0)? height=800(\.0)?"; then
  echo "FAIL: the chrome's surface is not the desktop it was given."
  echo "  It was told 1280x800 and its surface has to measure that, however it"
  echo "  says so. 2560x1600 is the buffer read as though nothing else spoke"
  echo "  for it, and every portal and pointer coordinate doubles with it;"
  echo "  320x240 is a chrome that never took its configure at all."
  echo "  --- what it said:"
  echo "  $FRAME"
  exit 1
fi
echo "PASS: the chrome's surface measures 1280x800"
echo
echo "So a CSS pixel in the chrome is 1.5 display pixels, which is what the"
echo "display is, and the desktop is drawn the size of the screen it covers."
