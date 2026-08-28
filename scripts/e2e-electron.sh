#!/usr/bin/env bash
# Reproducible proof of the full GUI path, headlessly (Electron under Xvfb):
#   Wayland client -> compositor -> host -> Electron chrome -> <domicile-app> mounted
#   -> geometry reported back (place_portal).
#
# And then the same path in the other direction, driven by the keyboard and the
# mouse this display has: Alt+Tab floats the window, holding Alt hands the
# pointer to the page, and an Alt+drag moves the window. Everything below the
# shell's own decisions is real — the re-layout, the SDK's measurement, and the
# placements the compositor is sent — so this is the only check that a window
# a user drags actually moves. The shell's own tests cover what it decides;
# nothing but this covers that anything is ever asked of it.
#
#   nix develop .#full -c ./scripts/e2e-electron.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
build_test_client || exit 1
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-xvfb"      # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"
# Named before the trap can fire. `set -u` turns a cleanup that runs before
# these are assigned — any early `exit` — into "unbound variable", which
# replaces whatever the real failure was with a line about the harness.
COMP=""; EL=""; XVFB=""; APP=""

# Electron is not on `PATH` outside `nix develop`, and its absence here reads
# as a renderer that never handshook.
if ! command -v electron >/dev/null 2>&1; then
  # Newest by version, not by store hash — see `check.sh`. Spelled out here
  # rather than shared, because a `scripts/` library holding one expression is
  # a worse thing to have than the expression twice.
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || { echo "SKIP: no electron to run the chrome with"; exit 77; }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

# Wait until $2 appears in file $1 (or time out). $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

# The last placement the chrome sent for a floating window — the whole message,
# because the parts checks 6 and 7 read (`transform`, `size`) come before the
# `type` field and a match anchored on that would not reach them.
floating() { grep -o '{"app_id":.*"z_index":1}' "$LOG" | tail -1; }

# Field $2 of a placement's `transform`: 5 and 6 are the translation, which is
# where on the page the window is. Kept at full precision — the page lays out
# in fractions of a CSS pixel and the arithmetic below is checked to the pixel.
transform_at() { echo "$1" | sed -n 's/.*"transform":\[\([^]]*\)\].*/\1/p' | cut -d, -f"$2"; }

# And field $2 of its `size`, the same way.
size_at() { echo "$1" | sed -n 's/.*"size":\[\([^]]*\)\].*/\1/p' | cut -d, -f"$2"; }

# CSS pixels are not display pixels, and on this Xvfb the ratio between them is
# neither 1 nor a whole number — the chrome reports 1.046875. So every number
# that crosses between `xdotool` (which moves display pixels) and a placement
# (which is in the page's own) goes through this, and `awk` does the arithmetic
# because the shell has no fractions.
pixels() { awk "BEGIN { printf \"%.0f\", $1 }"; }

RUST_LOG="info,domicile_compositor=debug" "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# By pid only. `pkill -f packages/shell-manganese` would also take out a chrome
# someone was running in another terminal, which is not this script's to end —
# the same hazard that had `measure.sh` killing the terminal it was started
# from.
# `kill`, not `kill -9`: a SIGKILLed X server cannot unlink its socket or its
# lock, and the corpse it leaves is indistinguishable to anything that tests
# for the socket from a display that is up.
cleanup() { kill "$COMP" "$EL" ${XVFB:-} "$APP" 2>/dev/null; rm -f "$LOG" "$ELOG"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

# The chrome is a TypeScript app now: build its Vite bundles before Electron
# resolves package.json's `main` (.vite/build/main.js).
( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) \
  || { echo "shell build failed"; exit 1; }

# Headless X for Electron: the one `check.sh` already made, or one of our own.
# Electron given a display that is not up does not wait; it dies, and a dead
# Electron looks exactly like a chrome that failed to hand shake — so a display
# that never arrived has to say why it did not, which is `ensure_display`'s
# whole job.
ensure_display 1280x800x24 60 || exit 1

# The session file, not the socket. `publish()` is the last statement in the
# compositor's `main()` — after every bind, the GPU probe and the whole event
# loop's construction — so the socket exists long before the document does, and
# a `cat` that ran on the socket's appearance would hand the chrome an empty
# `DOMICILE_SESSION`.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  echo "FAIL: the compositor never published a session; nothing can be started against it."
  exit 1
fi
DOMICILE_SESSION="$(cat "$SOCK.session")" \
  electron --no-sandbox --disable-gpu --disable-dev-shm-usage \
  "$ROOT/packages/shell-manganese/.vite/build/main.js" >"$ELOG" 2>&1 &
EL=$!

# 1) Wait for the Electron *renderer* to be up (it sends hello after loading).
if ! wait_for "$LOG" '"type":"hello"' 200; then echo "FAIL: Electron renderer never handshook"; exit 1; fi
echo "OK: Electron renderer connected and handshook"

# 2) Map a real Wayland client and wait until the compositor sees the toplevel.
WAYLAND_DISPLAY=wayland-1 "$TEST_CLIENT" --title app >/dev/null 2>&1 &
APP=$!
if ! wait_for "$LOG" "toplevel mapped" 50; then echo "FAIL: client never mapped a toplevel"; exit 1; fi
echo "OK: Wayland client mapped a toplevel (Host::app_appeared)"

# 3) The chrome should mount <domicile-app> and report its placement back.
# 10 seconds is plenty, and a longer deadline was measured not to help. Over
# 24 runs the timings are bimodal — 1.2-1.5s or the whole deadline, nothing in
# between — because the failure is not slowness. `bridge.on("app_appeared")`
# is registered in a React effect, after the first commit, while `hello` goes
# out as soon as the transport is up; a client that maps in the ~20ms between
# is announced to a chrome with no handler yet, and `#handleIncoming` drops it
# silently. Nothing re-announces, so that window never appears.
#
# That is a defect in the chrome rather than in this check, and it is not this
# change's to fix. What this change can do is stop a red run costing a minute
# to tell us the same thing.
# 60s, not 10. This is React mounting an element and reporting its box, behind
# a page that has only just loaded — and it is the last step of the last check
# in a suite that has already spent a minute compiling, so the machine running
# it is at its most loaded exactly here. Measured: this passes standalone and
# in the `e2e` group, and failed inside a full `check.sh`. A deadline a busy
# machine misses reports a working desktop as a broken one, which is the whole
# failure this harness exists to stop producing.
if wait_for "$LOG" "place_portal" 300; then
  echo "OK: Electron chrome mounted <domicile-app> and reported a portal"
else
  echo "FAIL: chrome did not report a portal within 60s."
  # The chrome's own output, because every other explanation for this looks
  # identical from the compositor's side: a renderer that crashed, a page that
  # threw before mounting, and a React tree that is merely slow all show up
  # here as the absence of one log line.
  echo "  what the chrome said:"; tail -12 "$ELOG" | sed 's/^/    /'
  echo "  what the compositor last saw:"; tail -6 "$LOG" | sed 's/^/    /'
  exit 1
fi

# 4) The compositor should extract the client's pixels and broadcast frames.
if wait_for "$LOG" "broadcast app frame" 50; then
  echo "OK: real client pixels extracted (shm -> RGBA) and pushed to the chrome"
else
  echo "FAIL: no app frames were broadcast"; exit 1
fi

# 5) And Alt+Tab should float that window, all the way through the real shell:
# the page answers the combination, re-lays the window out into a box of its
# own, and the placement that comes back carries a depth the compositor can
# stack a window by.
#
# Typed into Electron's own window rather than injected over the chrome socket.
# A `key` from a chrome is forwarded to whoever holds the keyboard and is
# deliberately not matched against the claimed shortcuts — a chrome injecting a
# key has already answered it — so the socket cannot press the desktop's own
# combination. What it can be pressed on is the keyboard Electron has, which is
# this Xvfb's; the page's own `keydown` is the path that fires, and it is the
# one that fires in a plain browser too.
#
# Everything below the page is real: the re-layout, the SDK's measurement, and
# the placement the compositor is sent. The reducer's own tests cover what the
# shell decides; nothing but this covers that a real window ever moves.
if ! command -v xdotool >/dev/null 2>&1; then
  # Late rather than at the top with the other guards, and the reason says so:
  # the four checks above need no keyboard and have already run, and a machine
  # without `xdotool` is better told which half it got than told nothing.
  echo "SKIP: no xdotool to press keys with, so the four checks above ran and the three that drive the shell did not."
  exit 77
fi
WID=""
for _ in $(seq 1 50); do
  WID="$(xdotool search --name "Domicile" 2>/dev/null | head -1)"
  [ -n "$WID" ] && break
  sleep 0.2
done
if [ -z "$WID" ]; then
  echo "FAIL: no Electron window on $DISPLAY to type into."
  echo "  what the chrome said:"; tail -12 "$ELOG" | sed 's/^/    /'
  exit 1
fi
# Focused directly rather than activated: there is no window manager here, so
# there is nothing to honour an activation request — and the key goes to
# whatever holds the input focus.
xdotool windowfocus "$WID" >/dev/null 2>&1
xdotool key alt+Tab >/dev/null 2>&1

# A window in the rail has no `z-index` at all, and nothing else in this shell
# gives one a non-zero one — so this number is the float and only the float.
if wait_for "$LOG" '"z_index":1}' 100; then
  echo "OK: Alt+Tab floated the window and the compositor was told its depth"
  floating | sed 's/^/    /'
else
  echo "FAIL: Alt+Tab did not reach the shell, or floating reported no depth."
  # The three ways this looks identical from here: the key never reached the
  # page, the page never answered it, and the portal never re-measured.
  echo "  the last placements the compositor was sent:"
  grep -o '"type":"place_portal".*' "$LOG" | tail -3 | sed 's/^/    /'
  echo "  what the chrome said:"; tail -12 "$ELOG" | sed 's/^/    /'
  exit 1
fi

# 5b) And the bar that floating gave the window has to claim the pointer where
# it lies. The compositor hit-tests rectangles, so a bar drawn across another
# window is invisible to it: without a claim the press on that bar goes to the
# window underneath, which focuses it and raises it — clicking the front
# window's title bar raises the one behind. This says the claim crosses the
# wire; `domicile-scene`'s own tests say what the compositor does with it.
# A region, not just the message: the shell sends the whole set every time, so
# an empty one is exactly what a bar that never got measured looks like — and
# it claims nothing, which is the bug this checks for.
if wait_for "$LOG" '"regions":\[{' 100; then
  echo "OK: the floating window's title bar claimed the pointer it covers"
  grep -o '{"regions":\[{[^]]*}\]' "$LOG" | tail -1 | sed 's/^/    /'
else
  echo "FAIL: the shell floated a window and claimed the pointer nowhere, so a"
  echo "  press on its title bar reaches whatever window the bar happens to lie"
  echo "  over rather than the page."
  echo "  what the chrome sent:"
  grep -o '"type":"[a-z_]*"' "$LOG" | sort | uniq -c | tail -12 | sed 's/^/    /'
  echo "  what the chrome said:"; tail -12 "$ELOG" | sed 's/^/    /'
  exit 1
fi

# 6) Holding Alt should hand the pointer to the page. The compositor hit-tests
# a rectangle and gives the pointer to the window under it, so a shell cannot
# see a drag over one of its own windows until that window says it takes no
# pointer — which is what `pointer-events: none` reports.
#
# Also the wait: this is the first thing that happens after the key, so it is
# what says the page has re-laid the window out and the sheet that catches the
# drag is up. A sleep here would be timing the same thing without checking it.
xdotool keydown alt
if wait_for "$LOG" '"takes_pointer":false' 100; then
  echo "OK: with Alt held the floating window takes no pointer"
else
  echo "FAIL: Alt did not make the floating window click-through, so a drag"
  echo "  over it would have gone to the client rather than to the shell."
  echo "  the last placements the compositor was sent:"
  grep -o '"type":"place_portal".*' "$LOG" | tail -3 | sed 's/^/    /'
  xdotool keyup alt
  exit 1
fi

# 7) And the drag itself: grab the middle of the window and pull it 90 display
# pixels across and 40 down.
#
# Aimed from what the compositor was told rather than from a guess: the
# placement carries the window's own transform, so the middle of the window is
# a number this already has. What has to be added back is where the page is —
# the window's origin on this display, and the ratio between the page's pixels
# and the display's.
RATIO="$(grep -o '"ratio":[0-9.]*' "$LOG" | tail -1 | cut -d: -f2)"
if [ -z "$RATIO" ]; then
  echo "FAIL: the chrome never reported its pixel ratio, so there is no way to"
  echo "  aim at the window: the page's coordinates and this display's differ"
  echo "  by exactly that number."
  xdotool keyup alt
  exit 1
fi
eval "$(xdotool getwindowgeometry --shell "$WID")"
BOX="$(floating)"
FROM_X="$(transform_at "$BOX" 5)"
FROM_Y="$(transform_at "$BOX" 6)"
CX="$(pixels "$X + ($FROM_X + $(size_at "$BOX" 1) / 2) * $RATIO")"
CY="$(pixels "$Y + ($FROM_Y + $(size_at "$BOX" 2) / 2) * $RATIO")"
xdotool mousemove "$CX" "$CY"
xdotool mousedown 1

# The window goes half transparent the moment it is taken hold of, and that
# translucency is the compositor's rather than the page's — so it arrives here
# as a number in the placement rather than as something the page painted over
# the window.
#
# Waited on rather than checked at the end, because it is also what says the
# page has taken hold: the sheet only starts following the pointer once React
# has re-rendered it holding the window, and a move dispatched before then is
# handled by a sheet that is not dragging anything.
if wait_for "$LOG" '"opacity":0.6' 100; then
  echo "OK: taking hold of the window reported it half transparent"
else
  echo "FAIL: the press never made the window see-through, so it was not seen"
  echo "  as taking hold of anything and the move below would test nothing."
  echo "  the last placements the compositor was sent:"
  grep -o '"type":"place_portal".*' "$LOG" | tail -3 | sed 's/^/    /'
  xdotool mouseup 1; xdotool keyup alt
  exit 1
fi

xdotool mousemove "$(( CX + 90 ))" "$(( CY + 40 ))"
xdotool mouseup 1
xdotool keyup alt

# Exactly as far as the pointer went, to the display pixel. A window that moves
# by its own idea of how far — a step, a cascade, a snap — is a window that is
# not following the mouse, and only the number catches that.
MOVED="$(pixels "($(transform_at "$(floating)" 5) - $FROM_X) * $RATIO")"
if [ "$MOVED" -eq 90 ]; then
  echo "PASS: Alt+drag moved the real window exactly as far as the pointer went"
  floating | sed 's/^/    /'
else
  echo "FAIL: the window moved ${MOVED} display pixels, not the 90 the pointer did."
  echo "  from: $BOX"
  echo "  to:   $(floating)"
  exit 1
fi
