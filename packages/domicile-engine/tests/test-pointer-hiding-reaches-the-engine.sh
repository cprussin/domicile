#!/usr/bin/env bash
# Tests that the config's pointer hiding settings reach the engine's pointer.
#
# The compositor writes `cursor_hiding` on `appearance`, the control channel
# sets `DeskPointerHiding`, `StartPointerHiding` listens to it and to the
# touchpad gestures `DeskGestures` takes, and a patch starts it. Missing any
# link still compiles and leaves the pointer shown, with clean logs.
#
# Needs no engine build, like `test-the-pointer-theme-reaches-the-engine.sh`.
# The fork's unit tests cover each link where an engine builds.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/packages/domicile-protocol/wire/host-messages.jsonl"
ENGINE="$ROOT/packages/domicile-engine"
CHANNEL="$ENGINE/src/components/domicile/browser/control_channel.cc"
HIDER="$ENGINE/src/chrome/browser/domicile/domicile_pointer_hiding.cc"
PATCHES="$ENGINE/patches/"

fail() {
  echo "  FAIL  $1" >&2
  shift
  for line in "$@"; do echo "        $line" >&2; done
  exit 1
}

for f in "$FIXTURE" "$CHANNEL" "$HIDER"; do
  [ -f "$f" ] || fail "no $f"
done

# The field names come from the fixture, which `wire.rs` pins to serde's.
grep -q '"type":"appearance",.*"cursor_hiding":{"after_ms":[0-9]*,"when_typing":\(true\|false\)}' \
  "$FIXTURE" || fail \
  "no appearance line with a cursor_hiding {after_ms, when_typing} in $FIXTURE" \
  "The names below are checked against that line."

ARM="$(awk '/\*type == "appearance"/,/^  }$/' "$CHANNEL")"
for read in 'FindDict("cursor_hiding")' 'FindDouble("after_ms")' \
  'FindBool("when_typing")' 'DeskPointerHiding::Get().Set'; do
  grep -qF "$read" <<<"$ARM" || fail \
    "$CHANNEL's \`appearance\` arm has no $read" \
    "The browser would read no settings, and the pointer never hides."
done

for listens in 'DeskPointerHiding::Get().AddListener' \
  'DeskGestures::Get().ListenForTouchpad' 'AddEventObserver'; do
  grep -qF "$listens" "$HIDER" || fail \
    "$HIDER has no $listens" \
    "The pointer would miss its settings or the input that shows it."
done

grep -rqs 'domicile::StartPointerHiding()' "$PATCHES" || fail \
  "no patch calls domicile::StartPointerHiding()" \
  "Nothing would observe aura's events."

echo "pointer hiding's field names and every link of its crossing agree"
