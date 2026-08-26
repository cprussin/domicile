#!/usr/bin/env bash
# Reproducible proof of the full GUI path, headlessly (Electron under Xvfb):
#   Wayland client -> compositor -> host -> Electron chrome -> <domicile-app> mounted
#   -> geometry reported back (place_portal).
#
#   nix develop .#full -c ./scripts/e2e-electron.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
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
COMP=""; EL=""; XVFB=""; FLOWER=""

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

RUST_LOG="info,domicile_compositor=debug" "$BIN" --no-shell --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# By pid only. `pkill -f packages/shell-manganese` would also take out a chrome
# someone was running in another terminal, which is not this script's to end —
# the same hazard that had `measure.sh` killing the terminal it was started
# from.
# `kill`, not `kill -9`: a SIGKILLed X server cannot unlink its socket or its
# lock, and the corpse it leaves is indistinguishable to anything that tests
# for the socket from a display that is up.
cleanup() { kill "$COMP" "$EL" ${XVFB:-} "$FLOWER" 2>/dev/null; rm -f "$LOG" "$ELOG"; }
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

DOMICILE_CHROME_SOCKET="$SOCK" electron --no-sandbox --disable-gpu --disable-dev-shm-usage "$ROOT/packages/shell-manganese" >"$ELOG" 2>&1 &
EL=$!

# 1) Wait for the Electron *renderer* to be up (it sends hello after loading).
if ! wait_for "$LOG" '"type":"hello"' 200; then echo "FAIL: Electron renderer never handshook"; exit 1; fi
echo "OK: Electron renderer connected and handshook"

# 2) Map a real Wayland client and wait until the compositor sees the toplevel.
WAYLAND_DISPLAY=wayland-1 weston-flower >/dev/null 2>&1 &
FLOWER=$!
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
  echo "PASS: real client pixels extracted (shm -> RGBA) and pushed to the chrome"
else
  echo "FAIL: no app frames were broadcast"; exit 1
fi
