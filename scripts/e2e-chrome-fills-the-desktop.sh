#!/usr/bin/env bash
# Checks the compositor sizes the chrome to the whole desktop, including after
# a display is added.
#
#   nix develop .#full -c ./scripts/e2e-chrome-fills-the-desktop.sh
#
# `present` draws the chrome at its committed size without scaling, so a
# wrong configure shows as a page in the corner of a black screen.
#
# `domicile-test-client --follow-configure` stands in for the chrome: it
# adopts whatever size the compositor configures. The compositor's sizing is
# under test. Checks that read the engine's pixels live in
# `packages/domicile-engine/scripts/`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
# Exit 1, not 77: failing to build our own client is a broken tree, not a
# missing machine capability.
build_test_client || exit 1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-fills"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; CLOG="$(mktemp)"; CONF="$XDG_RUNTIME_DIR/domicile.json"
COMP=""; CHROME=""

# A non-default size, so a chrome sized from anywhere else is caught.
WIDTH=1600
HEIGHT=900
cat >"$CONF" <<JSON
{ "output": { "displays": [{ "name": "only", "size": [$WIDTH, $HEIGHT] }] } }
JSON

# NO_COLOR: tracing puts color escapes between a field name and its value,
# which breaks the greps for `display="..."` below.
NO_COLOR=1 RUST_LOG=info,domicile_compositor=debug "$BIN" --session "$SOCK.session" --config "$CONF" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# TERM, not KILL: bash prints "Killed" when reaping a SIGKILLed child, which
# reads like a failure at the end of a passing run.
cleanup() { kill "$COMP" ${CHROME:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$CLOG" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

# Ask the compositor which display is the chrome's. `is_chrome_surface`
# classifies clients by the socket they connect on.
for _ in $(seq 1 100); do grep -q "the chrome connects here" "$LOG" && break; sleep 0.05; done
CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  harness_fault "$COMP" "the compositor could name its chrome display" \
    "ERROR: the compositor never said which display the chrome connects on;" \
    "  its log begins:" \
    "$(head -5 "$LOG")"
fi

# Any client on the chrome's display is treated as the chrome. The chrome
# protocol socket is not needed: this checks the surface configure, not the
# desktop description sent to the page.
#
# Wait for the session file: `publish()` runs last in the compositor's
# `main()`, so the Wayland socket can appear before the compositor is ready.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  echo "FAIL: the compositor never published a session; nothing can be started against it."
  exit 1
fi
WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  "$TEST_CLIENT" --title chrome --follow-configure >"$CLOG" 2>&1 &
CHROME=$!

# A chrome that exited commits nothing more, which would look like a
# compositor that stopped sizing it. Check it is alive before each verdict.
still_running() {
  kill -0 "$CHROME" 2>/dev/null
}

# Wait for the chrome's first commit.
for _ in $(seq 1 400); do grep -q "the chrome committed a frame" "$LOG" && break; sleep 0.1; done

echo "== what the chrome committed =="
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG" || echo "(nothing)"

# Use the latest commit: a client may draw once at its own size before it
# takes a configure.
COMMITTED="$(sed -n 's/.*the chrome committed a frame.*width=\([0-9]*\).*height=\([0-9]*\).*/\1x\2/p' "$LOG" | tail -1)"
if ! still_running; then
  harness_fault "$COMP" "the chrome could stay up" \
    "ERROR: the chrome exited before it committed anything; it said:" \
    "$(tail -20 "$CLOG")"
elif [ -z "$COMMITTED" ]; then
  harness_fault "$COMP" "the chrome could commit a frame at all" \
    "ERROR: the chrome never committed a frame, so its size was never" \
    "  established; the chrome said:" \
    "$(tail -20 "$CLOG")"
elif [ "$COMMITTED" = "${WIDTH}x${HEIGHT}" ]; then
  passed "the chrome committed at the desktop's own size"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome committed ${COMMITTED}, and the desktop is ${WIDTH}x${HEIGHT}" \
    "  \`present\` draws the chrome at the size it committed, so a chrome" \
    "  smaller than the desktop is a page in the corner of a black screen" \
    "  and one larger is a desktop with its edges off the output."
fi

# Add a second display. The compositor must reconfigure the chrome on reload
# to the bounding box of every display, not just one.
GREW_W=2880
GREW_H=1024
cat >"$CONF" <<'JSON'
{
  "output": {
    "displays": [
      { "name": "only", "size": [1600, 900] },
      { "name": "second", "position": [1600, 0], "size": [1280, 1024] }
    ]
  }
}
JSON

for _ in $(seq 1 400); do
  grep -q "width=${GREW_W}\.0 height=${GREW_H}\.0" "$LOG" && break
  sleep 0.1
done

echo
echo "== every size the chrome has committed =="
grep -oE "the chrome committed a frame width=[0-9.]+ height=[0-9.]+" "$LOG"

if ! after 1; then
  harness_fault "$COMP" "the first size could be checked" \
    "ERROR: the size the chrome started at was never established."
elif ! still_running; then
  harness_fault "$COMP" "the chrome could stay up to be resized" \
    "ERROR: the chrome exited before the desktop changed under it, so" \
    "  nothing here is about whether it would have grown; it said:" \
    "$(tail -20 "$CLOG")"
elif grep -q "width=${GREW_W}\.0 height=${GREW_H}\.0" "$LOG"; then
  passed "the chrome grew to span the desktop's second display"
else
  compositor_verdict "$COMP" \
    "FAIL: the desktop grew to ${GREW_W}x${GREW_H} — the box two displays" \
    "  make up — and the chrome did not follow it." \
    "  It is still at the size it first committed, and \`present\` draws it" \
    "  there — so the desktop is a page in the corner of a black screen." \
    "  The compositor reconfigures the chrome on a reload — but only if it" \
    "  saw one: a watcher that would not start is logged and run past, so" \
    "  read the line above before blaming the configure." \
    "$(grep -E "reloaded|not watching the config" "$LOG" | tail -1)"
fi

every_check_ran 2
