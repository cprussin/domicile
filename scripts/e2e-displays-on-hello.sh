#!/usr/bin/env bash
# Is a chrome told about a desktop of two configured displays?
#
#   nix develop .#full -c ./scripts/e2e-displays-on-hello.sh
#
# The chrome is one page spanning every display, and a display is a region of
# it, so `<Screen name="left">` needs the layout to cross the wire. Each half is
# unit-tested — the config normalises the positions, the host answers `hello`
# with the list, the schema decodes it — and none of that proves a compositor
# *started on a two-display config* describes two displays to a real chrome
# over a real socket.
#
# Needs no client and no display: the handshake is the whole of it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-displays-on-hello"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"; CONF="$(mktemp)"; COMP=""

# The left display sits at the origin and the right one beside it, at twice the
# density. Both facts have to survive the trip: the position is where a
# `<Screen>` goes on the page, and the scale is what clients on that display
# draw at.
cat >"$CONF" <<'TOML'
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 0]
size = [2560, 1440]
scale = 2
TOML

"$BIN" --config "$CONF" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the job quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
cleanup() { kill -9 "$COMP" 2>/dev/null; wait 2>/dev/null; rm -f "$OUT" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do
  [ -S "$SOCK" ] && break
  sleep 0.05
done

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/displays-probe.ts" >"$OUT" 2>&1

echo "== what the chrome was told the desktop is =="
cat "$OUT"

DESCRIBED="$(sed -n 's/^displays: //p' "$OUT")"
# Before the verdict: a probe that never printed its line at all — a missing
# dependency, a socket it could not open — would otherwise be reported as a
# compositor that described nothing, which is a delivery bug's verdict for a
# harness bug. `(never told)` is the compositor's silence and fails below;
# an empty `$DESCRIBED` is this script's own machinery.
EXPECTED="left@0,0+1920x1080@1 right@1920,0+2560x1440@2"
# One decision, with the bail as an arm rather than a guard above the verdict:
# a bail that turned into a no-op would otherwise drop past its own `if` and
# convict the compositor of a probe that printed nothing.
if [ -z "$DESCRIBED" ]; then
  harness_fault "$COMP" "the probe printed its displays line" \
    "ERROR: the probe printed no displays line; see its output above."
elif [ "$DESCRIBED" = "$EXPECTED" ]; then
  passed "the chrome was told both displays, where and how big they are"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome was told '$DESCRIBED'" \
    "  Expected '$EXPECTED'. A shell lays out against these: the name is" \
    "  what a <Screen> matches, the position is where it goes on the page," \
    "  and the scale is what clients on that display draw at."
fi

every_check_ran 1
