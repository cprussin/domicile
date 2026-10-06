#!/usr/bin/env bash
# Checks `wl-copy` and `wl-paste` work with no window focused, on both the
# clipboard and the primary selection.
#
#   nix develop .#full -c ./scripts/e2e-data-control.sh
#
# Both use `ext-data-control-v1`, or `zwlr_data_control_v1` when they predate
# it. Without either they wait for keyboard focus, which no window here has.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
command -v wl-copy >/dev/null && command -v wl-paste >/dev/null || {
  echo "SKIP: no wl-copy or wl-paste; they are in nix develop .#full"
  exit 77
}
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-data-control"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock*
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; COPIED="$(mktemp)"; CONF="$XDG_RUNTIME_DIR/domicile.json"
COMP=""
cat >"$CONF" <<'JSON'
{ "output": { "displays": [{ "name": "only", "size": [1280, 720] }] } }
JSON

NO_COLOR=1 RUST_LOG=info "$BIN" --session "$SOCK.session" --config "$CONF" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# Ends the compositor, which ends each `wl-copy` still serving a selection.
cleanup() { kill "$COMP" 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$COPIED" "$CONF"; }
trap cleanup EXIT

# `publish()` runs last in the compositor's `main()`, so the session file means
# it is ready.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  harness_fault "$COMP" "it published a session" \
    "ERROR: the compositor never published a session; its log ends:" \
    "$(tail -5 "$LOG")"
fi
WAYLAND_DISPLAY="$(jq -r .wayland_display "$SOCK.session")"
export WAYLAND_DISPLAY

# `wl-copy` forks a server and returns. Both get a deadline, since without
# data control they wait for focus forever. `wl-copy` says why it failed in
# `$COPIED`; its servers also complain there when the compositor exits.
timeout 10 wl-copy -- "copied with nothing focused" 2>>"$COPIED"
timeout 10 wl-copy --primary -- "selected with nothing focused" 2>>"$COPIED"
CLIPBOARD="$(timeout 10 wl-paste --no-newline 2>&1)"
PRIMARY="$(timeout 10 wl-paste --primary --no-newline 2>&1)"

if [ "$CLIPBOARD" = "copied with nothing focused" ]; then
  passed "wl-paste read what wl-copy copied"
else
  compositor_verdict "$COMP" \
    "FAIL: wl-paste read \"$CLIPBOARD\" from the clipboard, not what wl-copy" \
    "  copied. Clipboard managers need data control to work with no window" \
    "  focused. wl-copy said:" \
    "$(cat "$COPIED")"
fi

if ! after 1; then
  harness_fault "$COMP" "the clipboard was checked" \
    "ERROR: the clipboard check did not pass."
elif [ "$PRIMARY" = "selected with nothing focused" ]; then
  passed "wl-paste --primary read the primary selection, apart from the clipboard"
else
  compositor_verdict "$COMP" \
    "FAIL: wl-paste --primary read \"$PRIMARY\", not what wl-copy --primary" \
    "  copied. The data-control globals serve the primary selection too."
fi

every_check_ran 2
