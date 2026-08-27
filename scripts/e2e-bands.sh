#!/usr/bin/env bash
# Does the band round trip close, all the way through a real chrome?
#
#   nix develop .#full -c ./scripts/e2e-bands.sh
#
# A band is one depth of the chrome rendered on its own, so the compositor can
# draw a window *between* two layers of chrome. The compositor asks for one
# band at a time, and the frame that answers says which band it is in its own
# top-left pixel — see `domicile-protocol/src/band_label.rs`. Nothing else in
# this repo exercises that read-back, and nothing can: it is real GPU work
# against a real Chromium frame, so the row it reads, the byte order it reads
# in, and the colour Chromium actually painted are all only knowable here.
#
# So this runs the shell as a *Wayland client of ours* — which is what makes its
# commits reach the compositor at all, and what `e2e-electron.sh` is not: there
# the chrome renders to an X server and only its protocol connection reaches
# us. A second connection then declares a couple of depths, the compositor asks
# for each in turn, and the shell's own `renderBands` answers.
#
# The depths come from that second connection rather than from the shell, and
# that is the harness's limit rather than the design's: this shell declares
# depths when a window floats, floating one is Alt+Tab, and neither way of
# pressing it is available headlessly. A key injected over the chrome socket is
# forwarded to whoever holds the keyboard instead of being matched against the
# claims, and the compositor's own keyboard needs an X server that delivers to
# winit — which an Xvfb with no window manager does not. The bands are the
# desktop's rather than a connection's, so the compositor asks every chrome and
# the shell answers: everything from the question to the pixel and back is the
# real thing.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing.
build_test_client || exit 1
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

if ! command -v electron >/dev/null 2>&1; then
  # Newest by version, not by store hash — see `check.sh`. Spelled out here
  # rather than shared, because a `scripts/` library holding one expression is
  # a worse thing to have than the expression twice.
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || {
    echo "SKIP: no electron, which is the chrome whose frames carry the labels."
    exit 77
  }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

export XDG_RUNTIME_DIR="/tmp/domicile-rt-bands"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"
COMP=""; EL=""; DECLARER=""

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# NO_COLOR because the fields below are read back out of this log, and tracing
# writes SGR escapes *between* a field name and its value — a pattern for
# `band=0` matches the `0` in an escape sequence first.
NO_COLOR=1 RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `kill`, not `kill -9`, for the chrome: Electron is a process tree and a
# SIGKILLed one leaves bash reporting "Killed" on stderr as it reaps it — the
# last line of a run that passed, reading like a failure.
cleanup() { kill "$COMP" "$EL" "$DECLARER" 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$ELOG"; }
trap cleanup EXIT

# Sourced for all of it, not only the bails: the verdicts below are decisions
# in sequence, every arm ends in a helper that exits or in `passed`, and
# `every_check_ran` catches a bail that turned into a no-op. See
# `packages/e2e-harness/src/verdicts.ts`.
. "$ROOT/scripts/lib/harness.sh"

# Wait until $2 appears in file $1. $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ] && break; sleep 0.05; done

# Which display the chrome connects on is the compositor's to say: a client on
# the app socket is an app, and the socket is what tells them apart.
for _ in $(seq 1 100); do grep -q "the chrome connects here" "$LOG" && break; sleep 0.05; done
CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  harness_fault "$COMP" "the compositor could name its chrome display" \
    "ERROR: the compositor never said which display the chrome connects on;" \
    "  its log begins:" \
    "$(head -5 "$LOG")"
fi

# The session document, not the socket: `publish()` is the last statement in
# the compositor's `main()`, so the socket exists long before the document and
# a `cat` on the socket's appearance hands the chrome an empty session.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  harness_fault "$COMP" "the compositor could publish a session" \
    "ERROR: the compositor never published a session, so nothing can be" \
    "  started against it."
fi
# `composited` overridden, which is the one thing the published session cannot
# say here: the compositor reports whether *it* got a window (`--present`) and
# this one deliberately has none — but the chrome below is still a Wayland
# client of ours whose surface we composite, so it must be transparent rather
# than paint a background over the apps. Asserted rather than assumed, because
# the substitution depends on the exact spelling `to_string_pretty` produces
# and a serializer change would make it a silent no-op.
COMPOSITED_SESSION="$(sed 's/"composited": false/"composited": true/' "$SOCK.session")"
case "$COMPOSITED_SESSION" in
  *'"composited": true'*) ;;
  *) harness_fault "$COMP" "the session could be marked composited" \
       "ERROR: could not mark the session composited; the document reads:" \
       "$(cat "$SOCK.session")" ;;
esac

WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  DOMICILE_SESSION="$COMPOSITED_SESSION" \
  electron --no-sandbox --ozone-platform=wayland --disable-gpu \
  "$ROOT/packages/shell-manganese/.vite/build/main.js" >"$ELOG" 2>&1 &
EL=$!

if wait_for "$LOG" "the chrome committed a frame" 400; then
  passed "the shell is a Wayland client of ours, committing frames we composite"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome never committed a frame we could read, so there is" \
    "  nothing for a band to be carried in. Its own output:" \
    "$(tail -12 "$ELOG")"
fi

# After the shell has declared its own, which with nothing floating is none.
# The bands are the desktop's rather than a connection's, so whichever declares
# last is what the compositor holds — and a shell that declared after this
# would take the depths away again.
if ! wait_for "$LOG" '"depths":\[\]' 300; then
  harness_fault "$COMP" "the shell could declare its own depths" \
    "ERROR: the shell never said what depths it draws at, so a declaration" \
    "  from here would be one it is about to overwrite." \
    "$(tail -6 "$ELOG")"
fi

DOMICILE_CHROME_SOCK="$SOCK" DOMICILE_CHROME_LISTEN_MS=30000 timeout 40 bun \
  "$ROOT/packages/e2e-harness/src/band-declarer.ts" >/dev/null 2>&1 &
DECLARER=$!

if ! after 1; then
  harness_fault "$COMP" "the first check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif ! wait_for "$LOG" '"depths":\[0,1\]' 150; then
  harness_fault "$COMP" "the depths could be declared" \
    "ERROR: the second connection never declared any depths, so the" \
    "  compositor asked for nothing and nothing below was tested."
else
  passed "a desktop with declared depths asks for them one at a time"
fi

# Which bands the compositor has recognised an answer for, in order, once.
answered_bands() {
  grep -o "a band answered band=[0-9]*" "$LOG" | sed 's/.*=//' | sort -un | tr '\n' ' '
}
for _ in $(seq 1 200); do [ "$(answered_bands)" = "0 1 " ] && break; sleep 0.2; done

if ! after 2; then
  harness_fault "$COMP" "the second check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ "$(answered_bands)" != "0 1 " ]; then
  compositor_verdict "$COMP" \
    "FAIL: the compositor recognised bands [$(answered_bands)], not [0 1 ]." \
    "  The depths were declared, so the compositor asked. What is left is the" \
    "  label: it reads the band off the frame's own top-left pixel, and a" \
    "  frame whose label it cannot read is one it asks for again — for ever," \
    "  and silently. The row it reads, the byte order, and the colour" \
    "  Chromium painted are the three things only this can tell apart." \
    "  what the chrome said:" \
    "$(tail -8 "$ELOG")"
else
  passed "every band was read back off the chrome's own frames"
fi

every_check_ran 3
