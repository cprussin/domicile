#!/usr/bin/env bash
# Reproducible check that the chrome's close reaches a real client:
#   chrome `close_app` -> compositor -> xdg_toplevel.close -> the client goes
#
#   nix develop .#full -c ./scripts/e2e-close.sh
#
# The unit tests reach as far as the request landing on the Wayland thread. Only
# a real client can show the rest: that the toplevel it names is told to close,
# and that when the client acts on it the chrome is told the window is gone —
# which is what takes the tab off the rail.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"

# 77, not 0. A skip that exits 0 is indistinguishable from a check that ran and
# passed — `scripts/check.sh` tallies it as `ok` and `DOMICILE_CHECK_STRICT`
# cannot see it. Owned here rather than in `check.sh`'s guard block because the
# client is this script's business: what it needs is any client that maps a
# real toplevel, and it says so itself.
if ! command -v weston-flower >/dev/null 2>&1; then
  echo "SKIP: no weston-flower, and this needs a real client with a toplevel to close."
  exit 77
fi
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# libwayland colours WAYLAND_DEBUG even into a file, and tracing colours its own
# output; every check below reads those logs as plain text, and an escape landing
# mid-field is a grep that matches nothing and guards nothing.
export NO_COLOR=1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-close"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"      # what the chrome was told
CLIENT="$(mktemp)"   # what the client was told
COMP_LOG="$(mktemp)" # what the compositor did about it

# Named before the trap that kills them: under `set -u` a trap firing early —
# a compositor that never binds its socket, a Ctrl-C — reads an unset variable
# and dies with `unbound variable` instead of cleaning up.
PROBE=""
CLI=""

# At `info!`, because the compositor's own two lines about a close — it sent one,
# or it had no toplevel to send it to — are what separate the two ways the
# assertion below can fail: the message never reached the Wayland thread, or it
# reached it and named nothing. Discarded, a failure here says only "no".
RUST_LOG="info" "$BIN" --no-shell --chrome-socket "$SOCK" >"$COMP_LOG" 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" ${PROBE:-} ${CLI:-} 2>/dev/null; rm -f "$OUT" "$CLIENT" "$COMP_LOG"' EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# Connected before the client starts, so the announcement is heard live rather
# than through the replay a late chrome gets on `hello` — one less moving part
# between the close and the assertion. (`announce_open_apps` means a `bun` that
# takes longer to start than the sleep below degrades to that replay rather than
# to a failure; `e2e-late-chrome.sh` is what guards it.)
DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/close-probe.ts" >"$OUT" 2>&1 &
PROBE=$!
sleep 0.6

# WAYLAND_DEBUG logs every event the client receives, which is the only place
# `xdg_toplevel.close` is visible — a client that is asked to go produces no
# output of its own.
#
# `timeout` is the backstop for a client that ignores the close, not the way
# this ends: a run where the client is still there when it fires is a failure
# below, not a pass that took longer.
WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 15 weston-flower >"$CLIENT" 2>&1 &
CLI=$!

for _ in $(seq 1 100); do grep -qE "xdg_toplevel[#@][0-9]+\.close" "$CLIENT" && break; sleep 0.1; done

echo "== what the client was told =="
grep -oE "xdg_toplevel[#@][0-9]+\.close" "$CLIENT" | head -1
if grep -qE "xdg_toplevel[#@][0-9]+\.close" "$CLIENT"; then
  echo "PASS: the chrome's close reached the client's toplevel"
else
  echo "FAIL: the client was never asked to close — the close_app went nowhere"
  echo "--- what the compositor did ---"; tail -20 "$COMP_LOG"
  echo "--- the client's log ---"; tail -20 "$CLIENT"
  exit 1
fi

# The probe exits on `app_closed`, so this returns as soon as the window is
# gone — and with everything it printed flushed, which a kill would not be.
wait "$PROBE"

echo "== what the chrome was told =="
cat "$OUT"
if grep -q '"app_closed"' "$OUT"; then
  echo "PASS: the client acted on it and the chrome was told the window is gone"
else
  echo "FAIL: no app_closed — the window would stay on the rail forever"
  echo "--- what the compositor did ---"; tail -20 "$COMP_LOG"
  exit 1
fi
