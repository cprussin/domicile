#!/usr/bin/env bash
# What a keystroke actually costs, measured from the page that sent it.
#
#   nix run 'github:cprussin/domicile#measure-round-trip'
#   nix run 'github:cprussin/domicile?ref=some/branch#measure-round-trip' -- 60
#
# `measure.sh` deliberately does not measure this. It types over the host
# socket so its two paths are comparable, which puts the chrome's clock out of
# the loop — and `rt_ms` and `ipc_ms`, the two numbers a person actually feels,
# then go unmeasured on both. Its own legend says so. This is the other half.
#
# Keystrokes go in through Chromium's input pipeline, addressed to the chrome's
# window, exactly as a person's would: the SDK's document listener forwards them
# to the focused client, the client redraws, and the frame comes back through
# whatever transport the branch under test uses. The bridge sees both ends, so
# it can price the loop and the stages inside it.
#
# Headless: Xvfb, and the compositor's copy path. That is the path these
# numbers are about — on the native path nothing crosses the socket at all.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
cd "$ROOT"
KEYSTROKES="${1:-40}"
export NO_COLOR=1

BIN="$ROOT/target/release/domicile-compositor"
# Release, not debug. An unoptimised build spends 264ms a frame where release
# spends 20, which is a 4fps ceiling — every number below would be that ceiling
# rather than the thing being measured.
echo "== building (release) =="
cargo build --release -p domicile-compositor || exit 1
bun install --frozen-lockfile >/dev/null 2>&1 || true
bun run turbo build:vite --filter @domicile/shell-manganese >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}

if ! command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null | tail -1 || true)"
  [ -n "$ELECTRON_BIN" ] || { echo "no electron to run the chrome with"; exit 1; }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi
CLIENT="$(command -v kitty || command -v weston-terminal || true)"
[ -n "$CLIENT" ] || { echo "no terminal to type into"; exit 1; }

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/domicile-rt-trip}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
SOCK="$XDG_RUNTIME_DIR/round-trip.sock"; rm -f "$SOCK"
COMPLOG="$(mktemp)"; CHROMELOG="$(mktemp)"; APPLOG="$(mktemp)"
TYPISTLOG="$(mktemp)"; PROFILE=""
cleanup() {
  kill ${TYPIST:-} ${APP:-} ${CHROME:-} ${COMP:-} ${XVFB:-} 2>/dev/null
  wait 2>/dev/null
  rm -f "$COMPLOG" "$CHROMELOG" "$APPLOG" "$TYPISTLOG"
  [ -n "$PROFILE" ] && rm -rf "$PROFILE"
}
trap cleanup EXIT

# A display: the caller's if there is one, else one of our own. Electron given
# a dead display dies rather than waiting, which reads as a measurement of
# nothing — so a display that never arrived has to say why.
ensure_display 1280x800x24 60 || exit 1

echo "== the desktop =="
# `place_portal` — the chrome saying it mounted the window — is logged at
# debug. Asking for info and then waiting for it waits forever, and reports as
# "no window ever appeared".
RUST_LOG="info,domicile_compositor=debug" "$BIN" --no-shell --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done
[ -S "$SOCK" ] || { echo "the compositor never bound its socket"; tail -5 "$COMPLOG"; exit 1; }

# Port 0, and then ask Chromium which one it took — the same "hand the
# question to the thing that can answer it" as `-displayfd` above. A fixed port
# was in use one run in three, and Chromium's answer to that is to log
# `Address already in use` and carry on *without* a debugger, so the typist
# attaches to nothing and the run blames the compositor. Worse when a stale
# Electron holds the port: the typist then attaches to *that* browser and types
# into a different desktop.
PROFILE="$(mktemp -d)"
DOMICILE_CHROME_SOCKET="$SOCK" electron --no-sandbox --disable-gpu \
  --disable-dev-shm-usage --remote-debugging-port=0 \
  --user-data-dir="$PROFILE" \
  "$ROOT/packages/shell-manganese" >"$CHROMELOG" 2>&1 &
CHROME=$!
for _ in $(seq 1 900); do [ -s "$PROFILE/DevToolsActivePort" ] && break; sleep 0.1; done
PORT="$(head -1 "$PROFILE/DevToolsActivePort" 2>/dev/null)"
case "$PORT" in
  ''|*[!0-9]*)
    echo "the chrome never said which debugger port it took. Its last words:"
    tail -5 "$CHROMELOG"; exit 1;;
esac
# `hello`, not "chrome client connected". The socket connecting means a
# *process* is there; `hello` means the page is, and the page is what mounts a
# window. Waiting on the socket and then starting a client broadcasts
# `app_appeared` into a chrome whose renderer has not loaded yet, and the
# window never appears — which reads as a compositor that failed to announce it.
#
# Generously: Electron takes seconds to start even on hardware, and longer
# where it falls back to software rendering. A run whose chrome never arrived
# measures a compositor with nothing over the windows, and reports as a quietly
# better number rather than as the failure it is.
for _ in $(seq 1 900); do grep -q '"type":"hello"' "$COMPLOG" && break; sleep 0.1; done
grep -q '"type":"hello"' "$COMPLOG" || {
  echo "the chrome's page never handshook. Its last words:"; tail -5 "$CHROMELOG"; exit 1;
}

# Tolerant of whatever decoration the log carries: `NO_COLOR` is exported
# above, but a pattern that only matches undecorated output fails by finding an
# empty display, which starts a client against nothing and reports as "no
# window ever appeared".
APP_DISPLAY="$(sed -n 's/.*apps connect here.*display[^"]*"\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
[ -n "$APP_DISPLAY" ] || { echo "the compositor did not say where apps connect"; tail -5 "$COMPLOG"; exit 1; }
WAYLAND_DISPLAY="$APP_DISPLAY" "$CLIENT" >"$APPLOG" 2>&1 &
APP=$!
# 60 seconds. This is React mounting an element and reporting its box, behind
# a page that has only just loaded, in a release build with a cold profile —
# and at 30s it failed about half the time here while `e2e-electron.sh`, which
# waits the same way for the same thing, passed reliably at 60. A deadline a
# loaded machine misses reports a working desktop as a broken one.
for _ in $(seq 1 600); do grep -q "place_portal" "$COMPLOG" && break; sleep 0.1; done
grep -q "place_portal" "$COMPLOG" || {
  echo "no window ever appeared to type into."
  echo "  the compositor's last words:"; tail -6 "$COMPLOG" | sed 's/^/    /'
  echo "  the chrome's:"; tail -6 "$CHROMELOG" | sed 's/^/    /'
  echo "  the client's:"; tail -6 "$APPLOG" | sed 's/^/    /'
  exit 1
}

# A client's first frames are font caches and shader compiles, and a keystroke
# timed against those measures a thing that happens once.
sleep 6

echo "== typing $KEYSTROKES keystrokes into it =="
# Kept, not discarded: this is the process that knows whether the keys were
# sent at all, and sending its diagnosis to /dev/null is what made a debugger
# it could not reach read as a compositor that dropped the keystrokes.
bun "$ROOT/packages/e2e-harness/src/chrome-typist.ts" "$PORT" "$KEYSTROKES" \
  >"$TYPISTLOG" 2>&1 &
TYPIST=$!
if ! wait "$TYPIST"; then
  TYPIST=""
  echo "the typist could not drive the chrome:"
  tail -5 "$TYPISTLOG" | sed 's/^/  /'
  exit 1
fi
TYPIST=""

echo
echo "== what the chrome reported =="
# The last line, not the last three: the round trip accumulates over the run,
# so the final line is the whole run rather than whichever five seconds the
# tail happened to catch.
TRIP="$(grep "round trip" "$CHROMELOG" | tail -1)"
if [ -z "$TRIP" ]; then
  echo "   (nothing — no keystroke was answered by a frame)"
  echo "   The chrome only reports a round trip when it both sent a key and drew"
  echo "   the frame that answered it, so this means the keys did not reach a"
  echo "   window. The compositor's last words:"
  tail -5 "$COMPLOG" | sed 's/^/     /'
  exit 1
fi
echo "$TRIP"
# What the number is *of*, so two runs can be compared. `rt_ms` is dominated by
# bytes per frame, and neither the client nor its window size appears anywhere
# else in the output — two runs of this command on the same machine are not
# comparable without them.
echo "   client=$(basename "$CLIENT") $(sed -n 's/.*broadcast app frame.*width=\([0-9]*\) height=\([0-9]*\) bytes=\([0-9]*\).*/window=\1x\2 bytes_per_frame=\3/p' "$COMPLOG" | tail -1)"
grep "^typist: sent=" "$TYPISTLOG" | tail -1 | sed 's/^/   /'
ANSWERED="$(sed -n 's/.*round trip keys=\([0-9]*\)\/\([0-9]*\).*/\1 \2/p' <<<"$TRIP")"
set -- $ANSWERED
if [ "${1:-0}" -eq 0 ]; then
  echo
  echo "   Every keystroke went unanswered, so there is no round trip to report."
  echo "   The keys reached the page but no frame came back for them."
  exit 1
fi
if [ "${1:-0}" -lt "$(( ${2:-1} * 2 / 3 ))" ]; then
  echo
  echo "   WARNING: only $1 of $2 keystrokes were answered by a frame."
  echo "   The times below are over the ones that were, so they describe the"
  echo "   desktop on its good keystrokes and not what it did with the rest."
fi
echo
echo "== what the compositor reported =="
grep "frames sent=" "$COMPLOG" | tail -3

cat <<'LEGEND'

== reading this ==
  keys        answered/sent. They differ when the desktop swallowed a
              keystroke, and only the first is behind the times below — so a
              gap between them is the finding, not a footnote.
  rt_ms       mean of the whole run. Measured in the page, from the SDK's
              keydown handler to `putImageData` returning — so it holds the
              client's own redraw, and not Chromium's dispatch before it or
              the compositor's present after it.
  rt_median   what typing usually feels like. Prefer it to the mean: one
              stalled keystroke moves the mean and not this.
  rt_p95      the tail a person actually notices.
  ipc_ms      what the host's bytes cost between arriving in the chrome's
              process and reaching its page. Averaged over *messages*, not
              keystrokes, so it is not subtractable from rt_ms.
  draw_ms     and what putting them on the canvas cost. Same denominator as
              ipc_ms.
  msgs        host messages that carried an arrival stamp — frames and
              everything else. Not a frame count.

  Two runs are comparable only at the same client and window size, which is
  why both are printed. Numbers from a software rasteriser are not hardware
  numbers; what carries across is the ratio between two runs on one machine.
LEGEND
