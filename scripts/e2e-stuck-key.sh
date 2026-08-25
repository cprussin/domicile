#!/usr/bin/env bash
# A key held when the page goes away must not stay down in the seat.
#
# The compositor's keyboard state is one seat's, and it outlives every page and
# every window. A page that reloads or crashes mid-press never sends the
# release, so that key stays down in the seat — and for a lock key nothing can
# clear it afterwards: xkb unlocks one only on the release of the press it saw
# lock it, and while the key is still down every later press is a refcount on
# the filter already holding the lock rather than a new toggle.
#
# The desktop's own default keymap is what makes this the bug it is:
# `caps:swapescape` puts `Caps_Lock` on evdev 1, so one lost release means
# every window — including every window opened afterwards — types in capitals
# until Domicile is restarted.
#
# So: hold the key, reload, then toggle it. The client's `wl_keyboard.modifiers`
# is the verdict, because it is the thing every client reads its shift state
# from. Locked back to 0 means the toggle worked.
#
#   nix develop .#full -c ./scripts/e2e-stuck-key.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# A client that binds a keyboard and logs what it receives. Skipped rather than
# failed when it is absent: a check that cannot run must say so — see check.sh.
command -v weston-eventdemo >/dev/null 2>&1 || {
  echo "SKIP: no weston-eventdemo, which is the client that reports its modifiers."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-stuck"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
APP="$(mktemp)"
CHROME="$(mktemp)"

"$BIN" --no-shell --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill, or every passing run ends with the shell reporting
# "Killed" on stderr for a client that was still up — which reads like a
# failure in a run that passed.
cleanup() { kill -9 "$COMP" "$TYPIST" "$CLI" 2>/dev/null; wait 2>/dev/null; rm -f "$APP" "$CHROME"; }
trap cleanup EXIT
# `TYPIST` and `CLI` empty rather than unset, because `cleanup` names them and
# the decision below can exit while either is still unassigned — `set -u` would
# end such a run on "TYPIST: unbound variable", the last line a reader sees and
# nothing to do with why it stopped. `kill -9 ""` simply fails.
TYPIST=""
CLI=""

# Sourced for all of it, not only the bails: the verdicts below are one
# decision, every arm ends in a helper that exits or in `passed`, and
# `every_check_ran` catches a bail that turned into a no-op. See
# `packages/e2e-harness/src/verdicts.ts` for why an arm alone is not enough.
. "$ROOT/scripts/lib/harness.sh"
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# NO_COLOR and the `[#@]` alternation for the same reasons as e2e-input.sh:
# libwayland writes SGR escapes into these lines, and names objects `@14` on
# current releases and `#14` on older ones.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 20 weston-eventdemo >"$APP" 2>&1 &
CLI=$!
for _ in $(seq 1 100); do grep -q "xdg_surface" "$APP" && break; sleep 0.1; done

DOMICILE_CHROME_SOCK="$SOCK" timeout 20 bun "$ROOT/packages/e2e-harness/src/reload-typist.ts" >"$CHROME" 2>&1 &
TYPIST=$!
# A typist that gave up says so, and it is a different failure from the one
# this script is about: without this it dies after the press and the assertions
# below report a stuck lock, which is a compositor verdict for a harness fault.
if ! wait "$TYPIST"; then
  harness_fault "$COMP" "the chrome stand-in could finish its sequence" \
    "ERROR: the chrome stand-in did not finish its sequence, so the press it" \
    "  was meant to interrupt may never have been sent; its output was:" \
    "$(cat "$CHROME")"
fi

# The typist has finished sending; the client has not necessarily finished
# receiving. Those are two processes and two sockets, and every assertion below
# reads the client's log — a run that measures it early reports a keyboard left
# locked, which is exactly this script's bug rather than the harness being
# ahead of it.
#
# Counting `modifiers`, which is what every assertion below reads — not
# `key`, which is merely what precedes it. smithay sends the key and then the
# modifiers it changed, so the `locked=0` the verdict reads is written strictly
# after the last key event: a wait on keys can break between the two writes and
# leave `tail -1` reading the lock as still set.
#
# Five: one when the client is entered, and one after each of the four key
# events. The typist sends three of those — the fourth is the mechanism this
# script is about, since the reload's `hello` makes the compositor release
# whatever the seat had down and that synthetic release reaches the client like
# any other. The lock clears on the last of them, because xkb unlocks on the
# release of the press it saw lock.
#
# A genuinely stuck compositor never sends that synthetic release, so it never
# reaches five and pays this bound in full. Six seconds, chosen to be
# affordable against the client's own `timeout 20` rather than to be generous —
# and giving up is a verdict of its own below rather than a fall-through into
# the lock state, which cannot tell a stuck compositor from a slow client.
for _ in $(seq 1 60); do
  [ "$(grep -cE "wl_keyboard[#@][0-9]+\.modifiers\(" "$APP")" -ge 5 ] && break
  sleep 0.1
done

echo "== what the client was told about the keyboard =="
grep -oE "wl_keyboard[#@][0-9]+\.(key|modifiers)\([^)]*\)" "$APP"

keys=$(grep -cE "wl_keyboard[#@][0-9]+\.key\(" "$APP")
mods=$(grep -cE "wl_keyboard[#@][0-9]+\.modifiers\(" "$APP")

# `modifiers(serial, depressed, latched, locked, group)` — the fourth argument
# is the lock state.
lock_states() {
  grep -oE "wl_keyboard[#@][0-9]+\.modifiers\([^)]*\)" "$APP" \
    | sed -E 's/.*\(([^)]*)\)/\1/' | cut -d, -f4 | tr -d ' '
}

# One decision, so that no arm is reachable by falling past another — and in
# this order, because each arm's premise is the arm before it having held.
if [ "$keys" -lt 1 ]; then
  # The typist has already been waited on and exited zero, so the keys were
  # sent. None arriving is the compositor not forwarding them.
  compositor_verdict "$COMP" \
    "FAIL: no key events reached the client, so nothing below was tested." \
    "  The chrome stand-in finished its sequence, so these were sent."
elif [ "$mods" -lt 5 ]; then
  # The wait above gave up. Said out loud rather than fallen through: every
  # arm below reads the lock state, and reading it early reports a keyboard
  # left locked — this script's own bug, convicted for a run that was measured
  # too soon. The two are indistinguishable from here, so this says so instead
  # of picking one, and `compositor_verdict` rules out the third possibility
  # before either is named.
  compositor_verdict "$COMP" \
    "FAIL: the client was told its modifiers $mods times in 6s, not 5." \
    "  Either the reload never released the key it interrupted — which is the" \
    "  bug this script exists to catch, and leaves the last modifiers event" \
    "  unsent — or this client was slower than the bound. The lock state below" \
    "  cannot tell those apart, which is why it is not the verdict here."
elif ! lock_states | grep -qvE '^0$'; then
  # It has to lock before clearing means anything. A run where the press was
  # never `Caps_Lock` at all ends on `locked=0` too, and that is reachable
  # without touching this file: the compositor reads `domicile.toml` from the
  # working directory, so a checkout that grows one with different
  # `xkb_options` would turn this into a check that tests nothing.
  harness_fault "$COMP" "the keyboard locked at all" \
    "ERROR: the keyboard never locked, so the toggle below proves nothing." \
    "  evdev 1 is Caps_Lock under the default keymap's caps:swapescape." \
    "  A domicile.toml in the working directory would be enough to change" \
    "  that, and this check cannot tell the difference from the lock it is" \
    "  looking for."
elif [ "$(lock_states | tail -1)" = "0" ]; then
  # And the last line is where the keyboard ended up.
  passed "the lock cleared, so the key the reload interrupted was not left down"
else
  compositor_verdict "$COMP" \
    "FAIL: the keyboard is left locked (mods_locked=$(lock_states | tail -1))" \
    "  A key held when the page reloaded is still down in the seat, so the" \
    "  press that should have toggled the lock off was swallowed as a" \
    "  refcount on it. Every client — including ones opened afterwards —" \
    "  is told this state on enter."
fi

every_check_ran 1
