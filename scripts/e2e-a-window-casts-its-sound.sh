#!/usr/bin/env bash
# Checks a window's cast carries its own app's sound, and no other app's, in
# the window's sound node, and that the node goes a few seconds after the
# cast ends.
#
#   nix develop .#full -c ./scripts/e2e-a-window-casts-its-sound.sh
#
# Starts its own headless `pipewire` daemon, with no session manager, so the
# check configures the players' and the recorder's ports with `pw-cli` and
# links the recorder with `pw-link`, as a session manager would. The
# compositor links the players into the cast's audio node itself.
#
# The window's client starts a player as its child, playing samples of 16448
# (0x4040). Another player, no kin of the client's, plays 8224 (0x2020). The
# cast's sound holds the first alone: with both, samples would be 24672.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"

for tool in pipewire pw-cat pw-cli pw-link od; do
  command -v "$tool" >/dev/null || {
    echo "SKIP: no $tool here; run inside nix develop .#full, or install pipewire"
    exit 77
  }
done

BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
build_test_client || exit 1

export XDG_RUNTIME_DIR="/tmp/domicile-rt-sound"   # short: Unix socket path limit
rm -rf "$XDG_RUNTIME_DIR"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; PWLOG="$(mktemp)"; SOUND="$(mktemp)"
PW=""; COMP=""; CLIENT=""; STRANGER=""; RECORDING=""
# TERM, not KILL: bash prints "Killed" when reaping a SIGKILLed child.
cleanup() {
  kill $RECORDING $STRANGER $CLIENT $COMP $PW 2>/dev/null; wait 2>/dev/null
  rm -f "$LOG" "$PWLOG" "$SOUND"; rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT

pipewire >"$PWLOG" 2>&1 &
PW=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/pipewire-0" ] && break; sleep 0.05; done
# Exit 1: there is no compositor yet for a harness helper to check, and a
# pipewire that will not start leaves nothing to cast to.
[ -S "$XDG_RUNTIME_DIR/pipewire-0" ] || {
  echo "ERROR: pipewire made no socket; it said:"; tail -20 "$PWLOG"; exit 1
}

# The id of the node named $1, once it shows.
node_id() {
  local id=""
  for _ in $(seq 1 100); do
    id="$(pw-cli ls Node 2>/dev/null | awk -v name="node.name = \"$1\"" '
      /^\tid [0-9]+,/ { id = $2; sub(",", "", id) }
      index($0, name) { print id; exit }')"
    [ -n "$id" ] && break; sleep 0.05
  done
  echo "$id"
}

# Gives node $1 stereo ports facing $2 (Input or Output), as a session
# manager would.
configure() {
  pw-cli set-param "$1" PortConfig "{ direction: $2, mode: dsp, format: {
    mediaType: audio, mediaSubtype: raw, format: F32P, rate: 48000,
    channels: 2, position: [ FL FR ] } }" >/dev/null
}

# Plays samples of byte $1 into a node named $2, for a minute.
play() {
  head -c 11520000 /dev/zero | tr '\0' "\\$1" \
    | pw-cat --playback --raw --target 0 -P "{ node.name = $2 }" - 2>/dev/null
}

TITLE="cast-my-sound"
NO_COLOR=1 DOMICILE_CAST_WINDOW="$TITLE" RUST_LOG=info,domicile_compositor=debug \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done
# The player is the client's child: the shell starts it, then becomes the
# client.
export -f play
WAYLAND_DISPLAY=wayland-1 bash -c \
  'play 100 own-player & exec "$TEST_CLIENT" --title "$0" >/dev/null 2>&1' "$TITLE" &
CLIENT=$!
play 040 stranger-player &
STRANGER=$!

for _ in $(seq 1 200); do grep -q "cast sound node made" "$LOG" && break; sleep 0.05; done
NAME="$(sed -n 's/.*cast sound node made.* name=\([^ ]*\).*/\1/p' "$LOG" | head -1)"
if [ -n "$NAME" ]; then
  passed "the window's cast has sound node $NAME"
else
  compositor_verdict "$COMP" \
    "FAIL: the compositor made no sound node for its cast of \"$TITLE\"." \
    "  Its log:" "$(grep -E "cast|PipeWire" "$LOG" | tail -10)"
fi

OWN="$(node_id own-player)"; STRANGE="$(node_id stranger-player)"
SINK="$(node_id "$NAME")"
[ -n "$OWN" ] && configure "$OWN" Output
[ -n "$STRANGE" ] && configure "$STRANGE" Output
timeout 20 pw-record --raw --target 0 -n 48000 -P '{ node.name = recorder }' - \
  >"$SOUND" 2>/dev/null &
RECORDING=$!
REC="$(node_id recorder)"
[ -n "$REC" ] && configure "$REC" Input
for _ in $(seq 1 100); do
  pw-link -i 2>/dev/null | grep -q "recorder:input_FR" \
    && pw-link -o 2>/dev/null | grep -q "$NAME:capture_FR" && break
  sleep 0.05
done
pw-link "$NAME:capture_FL" "recorder:input_FL" 2>&1
pw-link "$NAME:capture_FR" "recorder:input_FR" 2>&1
wait "$RECORDING"; RECORDED=$?; RECORDING=""

# The commonest sample. Silence leads until the player's sound arrives, so
# skip the first half.
COMMONEST="$(od -An -v -td2 -w2 "$SOUND" | tail -n +48000 | sort | uniq -c \
  | sort -rn | awk 'NR == 1 { print $2 }')"
if ! after 1; then
  harness_fault "$COMP" "the cast had a sound node" "ERROR: no node to record."
elif [ -z "$OWN" ] || [ -z "$STRANGE" ] || [ -z "$REC" ] || [ -z "$SINK" ]; then
  harness_fault "$COMP" "the players and recorder showed" \
    "ERROR: a node never showed: own=$OWN stranger=$STRANGE recorder=$REC sound=$SINK" \
    "  pipewire said:" "$(tail -10 "$PWLOG")"
elif [ "$COMMONEST" = "16448" ]; then
  passed "the cast's sound is the window's app's alone"
else
  compositor_verdict "$COMP" \
    "FAIL: the cast's commonest sample is ${COMMONEST:-none}, not 16448 (exit $RECORDED)." \
    "  24672 is both players; 8224 is the stranger's alone. Links:" \
    "$(pw-link -l 2>/dev/null | grep -A3 "$NAME" | head -10)" \
    "  The compositor said:" "$(grep -E "sound|cast" "$LOG" | tail -10)"
fi

# Closing the window ends its cast, and the sound node goes once the
# recorder is gone too and its grace (5 s) is up.
kill "$CLIENT" 2>/dev/null; wait "$CLIENT" 2>/dev/null; CLIENT=""
for _ in $(seq 1 200); do
  pw-cli ls Node 2>/dev/null | grep -q "node.name = \"$NAME\"" || break; sleep 0.05
done
if ! after 2; then
  harness_fault "$COMP" "the cast's sound was recorded" "ERROR: nothing to end."
elif ! pw-cli ls Node 2>/dev/null | grep -q "node.name = \"$NAME\""; then
  passed "the sound node went with the window"
else
  compositor_verdict "$COMP" \
    "FAIL: the window closed and its cast's sound node stayed. The compositor said:" \
    "$(grep -E "cast" "$LOG" | tail -10)"
fi

every_check_ran 3
