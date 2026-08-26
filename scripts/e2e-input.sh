#!/usr/bin/env bash
# Prove forwarded input reaches a real client, keyboard AND pointer. Runs
# `weston-eventdemo` on Domicile with WAYLAND_DEBUG so we can see the exact protocol
# events it receives, and forwards a focus+pointer+key sequence via the chrome
# protocol.
#   nix develop .#full -c ./scripts/e2e-input.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-input"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
APP="$(mktemp)"
CHROME="$(mktemp)"
# `CLI` empty rather than unset, because `cleanup` names it and the handshake
# bail below exits between the trap being installed and the client being
# started. `set -u` would turn that into "CLI: unbound variable" on the way
# out — the last line a reader sees, and nothing to do with why the run
# stopped. `kill -9 ""` simply fails. `INJ` needs no such thing: it is assigned
# before the first line that can leave.
CLI=""

"$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" "$INJ" "$CLI" 2>/dev/null; rm -f "$APP" "$CHROME"; }
trap cleanup EXIT

# Both bails, so that neither kind of failure is reported as the other:
# `harness_fault` re-checks the compositor before blaming this script's own
# machinery, and `compositor_verdict` re-checks it before naming a check as the
# thing that failed. See `packages/e2e-harness/src/verdicts.test.ts`.
#
# Not the counting discipline that goes with them. `every_check_ran` exists
# because a bail that turns into a no-op leaves its decision undecided, and the
# count is what turns the resulting silence into a failure — this script has no
# `passed` calls and no count, so its checks are sequential `if`s rather than
# arms of one decision. Every arm here ends in a helper that exits, so nothing
# is undecided today; the note is here because sourcing this file is the signal
# a reader would otherwise take for the whole discipline.
. "$ROOT/scripts/lib/harness.sh"
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# Connect the injector first so it's subscribed before the app appears — and
# wait for the handshake it prints rather than for long enough that it has
# probably happened. The injector only forwards input once it has seen an
# `app_frame`, so a `bun` slower than the guess misses the client's frames
# entirely and every check below reports a compositor that delivered no input
# at all.
DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/input-injector.ts" >"$CHROME" 2>&1 &
INJ=$!
# Bounded under the injector's own 5s `RUN_MS`, so this cannot outlive the
# process it is waiting on and spend the tail polling a writer that has already
# exited.
# `displays` rather than `welcome`, because a `welcome` is not agreement: the
# host answers a version it refuses with one too, so that the chrome can say
# which two versions disagreed. The desktop rides only with the handshake it
# accepted, so it is the line that means this connection will be listened to.
# Waiting on the welcome would let a version-mismatched injector through, have
# every message it sends dropped, and end the run on the compositor verdict
# below — the misattribution this whole change is about.
for _ in $(seq 1 80); do grep -q '"type":"displays"' "$CHROME" && break; sleep 0.05; done
# And said out loud through the bail that re-checks the compositor. A wait that
# merely gives up is the same fault one step later, and blaming the harness
# without asking is its mirror image: a compositor that binds both sockets and
# then dies produces exactly this silence, and `connectChromeSocket` swallows
# the connection error, so it would be reported as a `bun` that would not start.
if ! grep -q '"type":"displays"' "$CHROME"; then
  harness_fault "$COMP" "the injector could complete its handshake" \
    "ERROR: the injector never handshook, so nothing below it was tested;" \
    "  its output was:" \
    "$(cat "$CHROME")"
fi

# WAYLAND_DEBUG makes the client log every protocol event it receives. It names
# objects `wl_keyboard@14` on current libwayland and `wl_keyboard#14` on older
# releases, so the greps below accept either. NO_COLOR because current
# libwayland also writes SGR escapes between the interface name and the event,
# which no plain-text grep can match.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 6 weston-eventdemo >"$APP" 2>&1 &
CLI=$!
# Wait for a real key event: `.key(` and not `.keymap`, which arrives at once
# and would end the wait before any input had been forwarded.
for _ in $(seq 1 60); do grep -qE "wl_keyboard[#@][0-9]+\.key\(" "$APP" && break; sleep 0.1; done

echo "== input events the client received =="
grep -oE "wl_(pointer|keyboard)[#@][0-9]+\.(enter|motion|button|key)\([^)]*\)" "$APP" | head
key_ok=$(grep -cE "wl_keyboard[#@][0-9]+\.key\(" "$APP")
btn_ok=$(grep -cE "wl_pointer[#@][0-9]+\.button\(" "$APP")
if [ "$key_ok" -ge 1 ] && [ "$btn_ok" -ge 1 ]; then
  echo "PASS: forwarded keyboard + pointer input reached the client"
else
  compositor_verdict "$COMP" \
    "FAIL: keyboard=$key_ok pointer_button=$btn_ok"
fi

# The pointer entering a surface makes the client ask for a cursor, which the
# host hands back to the chrome as a CSS keyword for that app's element.
#
# Waited for in the injector's own output, because that is what is read below.
# The client's key event above is the wrong evidence for it: the cursor is a
# request the client makes on pointer enter, so it is still travelling back out
# through the host while the key is already in the client's log — and the two
# lines are two processes writing two files. Bounded, so a cursor that never
# reaches the chrome fails here rather than hanging.
for _ in $(seq 1 60); do grep -q '"app_cursor"' "$CHROME" && break; sleep 0.1; done

echo "== cursor the client asked the chrome for =="
grep -m1 '"app_cursor"' "$CHROME"
if grep -q '"app_cursor"' "$CHROME"; then
  echo "PASS: the client's cursor request reached the chrome"
else
  compositor_verdict "$COMP" "FAIL: no app_cursor reached the chrome"
fi

# And who holds the keyboard. The chrome asked for this focus, so this proves
# the message reaches a real chrome over a real socket rather than that the
# compositor volunteers it — the click that moves focus *without* the chrome
# asking arrives through Domicile's own window, which needs a display and so is
# covered by the host's unit tests instead.
# Its own wait, rather than leaning on the cursor's above: the two lines land
# in that order today only because the injector asks for the focus before it
# moves the pointer, and a check whose premise is the order of somebody else's
# messages fails here the day that changes — as a chrome that was never told
# who holds the keyboard.
for _ in $(seq 1 60); do
  grep -q '"app_id":"app-1","type":"focus_changed"' "$CHROME" && break
  sleep 0.1
done

echo
echo "== who the chrome was told holds the keyboard =="
# The one the assertion is about, not the first on the wire: a chrome is caught
# up with the current holder as it connects, so `-m1` printed the catch-up
# (`"app_id":null`) while the assertion below was passing on a later line.
grep -m1 '"app_id":"app-1","type":"focus_changed"' "$CHROME"
if grep -q '"app_id":"app-1","type":"focus_changed"' "$CHROME"; then
  echo "PASS: the chrome was told which window has the keyboard"
else
  compositor_verdict "$COMP" \
    "FAIL: no focus_changed naming the focused app reached the chrome" \
    "  Without it a desktop's active-window marker is right until the first" \
    "  click and wrong afterwards."
fi
