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

"$BIN" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill, or every passing run ends with the shell reporting
# "Killed" on stderr for a client that was still up — which reads like a
# failure in a run that passed.
cleanup() { kill -9 "$COMP" "$TYPIST" "$CLI" 2>/dev/null; wait 2>/dev/null; rm -f "$APP" "$CHROME"; }
trap cleanup EXIT
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
  echo "FAIL: the chrome stand-in did not finish its sequence"
  cat "$CHROME"
  exit 1
fi

echo "== what the client was told about the keyboard =="
grep -oE "wl_keyboard[#@][0-9]+\.(key|modifiers)\([^)]*\)" "$APP"

keys=$(grep -cE "wl_keyboard[#@][0-9]+\.key\(" "$APP")
if [ "$keys" -lt 1 ]; then
  echo "FAIL: no key events reached the client, so nothing here was tested"
  exit 1
fi

# `modifiers(serial, depressed, latched, locked, group)` — the fourth argument
# is the lock state.
lock_states() {
  grep -oE "wl_keyboard[#@][0-9]+\.modifiers\([^)]*\)" "$APP" \
    | sed -E 's/.*\(([^)]*)\)/\1/' | cut -d, -f4 | tr -d ' '
}

# It has to lock before clearing means anything. A run where the press was
# never `Caps_Lock` at all ends on `locked=0` too, and that is reachable
# without touching this file: the compositor reads `domicile.toml` from the
# working directory, so a checkout that grows one with different
# `xkb_options` would turn this into a check that tests nothing.
if ! lock_states | grep -qvE '^0$'; then
  echo "FAIL: the keyboard never locked, so the toggle below proves nothing."
  echo "  evdev 1 is Caps_Lock under the default keymap's caps:swapescape."
  echo "  A domicile.toml in the working directory would be enough to change"
  echo "  that, and this check cannot tell the difference from the lock it is"
  echo "  looking for."
  exit 1
fi

# And the last line is where the keyboard ended up.
locked=$(lock_states | tail -1)
if [ "${locked:-unset}" = "0" ]; then
  echo "PASS: the lock cleared, so the key the reload interrupted was not left down"
else
  echo "FAIL: the keyboard is left locked (mods_locked=${locked:-none})"
  echo "  A key held when the page reloaded is still down in the seat, so the"
  echo "  press that should have toggled the lock off was swallowed as a"
  echo "  refcount on it. Every client — including ones opened afterwards —"
  echo "  is told this state on enter."
  exit 1
fi
