#!/usr/bin/env bash
# The reload case: a client is already running when the chrome arrives.
#
# `e2e-electron.sh` starts the chrome first, so every window it mounts is one
# it heard about live. That is the easy half. This is the other half, and the
# one that breaks:
#
#   Wayland client maps -> (nothing is listening) -> Electron chrome connects
#   -> the desktop it comes up to has that window in it.
#
# Same path a page reload takes, and the same path a client that maps in the
# milliseconds after the handshake takes. Two things have to be true for it to
# pass: the compositor has to say `app_appeared` again on `hello`, and the
# chrome has to still be holding that message when React registers its
# handlers — which it does tens of milliseconds *after* `connect()`, always,
# because rendering only schedules the effect that registers them.
#
#   nix develop .#full -c ./scripts/e2e-late-chrome.sh
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-late"      # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"

# Wait until $2 appears in file $1 (or time out). $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

RUST_LOG="info,domicile_compositor=debug" "$BIN" --no-shell --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# Named before the trap that reads them: under `set -u` a trap firing before
# the last of them is assigned — a compositor that never binds its socket, a
# Ctrl-C during the shell build — died with `unbound variable` instead of
# cleaning up, which is how a run of this script left a live Electron behind.
EL=""; XVFB=""; FLOWER=""
# By pid only — see `e2e-electron.sh` for why `pkill -f` is not this script's
# to use. TERM rather than KILL for the X server, and only for it: a `kill -9`d
# X server cannot unlink its socket or its lock, and `e2e-no-compositor.sh`
# records what that corpse then costs the next run.
cleanup() {
  kill -9 "$COMP" ${EL:-} ${FLOWER:-} 2>/dev/null
  kill ${XVFB:-} 2>/dev/null
  rm -f "$LOG" "$ELOG"
}
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

# Both of these before anything starts, because a check that cannot run says
# nothing and a check that ran and blamed the compositor for a client it could
# not start says something false. Without them this script waited out its own
# `wait_for` and convicted the compositor at `exit 1` — a missing dependency
# reported as a code failure, which is what 77 exists to prevent.
command -v weston-flower >/dev/null 2>&1 || {
  echo "SKIP: no weston-flower, which is the client that maps before any chrome."
  exit 77
}
command -v electron >/dev/null 2>&1 || {
  echo "SKIP: no electron, which is the chrome that arrives late here."
  exit 77
}

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) \
  || { echo "shell build failed"; exit 1; }

# 1) Map a real Wayland client with *no chrome connected*. This is what makes
#    the test what it is: the one `app_appeared` this client will ever cause
#    goes out to nobody.
WAYLAND_DISPLAY=wayland-1 weston-flower >/dev/null 2>&1 &
FLOWER=$!
if ! wait_for "$LOG" "toplevel mapped" 100; then echo "FAIL: client never mapped a toplevel"; exit 1; fi
grep -q '"type":"hello"' "$LOG" && { echo "FAIL: a chrome connected before the client mapped; this tests nothing"; exit 1; }
echo "OK: Wayland client mapped a toplevel with no chrome listening"

# Headless X for Electron: the one `check.sh` already made, or one of our own.
# This used to be `Xvfb :98` and a `sleep 0.8` — a number picked and hoped for,
# and a guess in place of a wait. `check.sh`'s own comment blames that pattern
# for a stale `/tmp/.X11-unix/X97` becoming an Electron segfault that looked
# like a bug in the shell.
# 77 rather than 1, as `e2e-electron.sh` does for the same reason: no display
# is a dependency this machine does not have, not a verdict on the compositor.
ensure_display 1280x800x24 60 || {
  echo "SKIP: no display for Electron to render into."
  exit 77
}

# 2) Now start the chrome.
DOMICILE_CHROME_SOCKET="$SOCK" electron --no-sandbox --disable-gpu --disable-dev-shm-usage "$ROOT/packages/shell-manganese" >"$ELOG" 2>&1 &
EL=$!
if ! wait_for "$LOG" '"type":"hello"' 200; then echo "FAIL: Electron renderer never handshook"; exit 1; fi
echo "OK: Electron renderer connected and handshook"

# 3) The window that was already open has to end up on screen. `place_portal`
#    is the chrome saying it mounted a <domicile-app> and laid it out, which it
#    cannot do for a window it was never told about.
if wait_for "$LOG" "place_portal" 100; then
  echo "OK: the chrome mounted the window that was already open"
else
  echo "FAIL: the chrome came up to an empty desktop with a client still drawing"; exit 1
fi

# 4) And pixels have to follow. Proves the placement is wired to the copy path
#    and not just an element with nothing behind it.
#
#    What this does not prove is that the canvas has the pixels *in* it —
#    nothing the chrome sends back says so. `place_portal` is as far into the
#    page as this script can see.
if wait_for "$LOG" "broadcast app frame" 50; then
  echo "PASS: a client that was already running gets its window back"
else
  echo "FAIL: no app frames were broadcast"; exit 1
fi
