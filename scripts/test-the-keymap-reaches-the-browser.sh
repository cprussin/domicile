#!/usr/bin/env bash
# Tests that the browser reads the keymap message the compositor sends.
#
# The compositor compiles a keymap from `input.keyboard` and writes
# `{"type":"keymap","keymap":"..."}` to the chrome control socket.
# `ControlChannel::DispatchLine` in the engine fork reads it, and it is the
# only source of a keyboard layout for the DRM/Ozone browser. See
# `packages/domicile-engine/src/components/domicile/browser/keyboard_layout.h`.
#
# serde derives the tag and field name in Rust; the C++ spells them as string
# literals. `wire/host-messages.jsonl` ties Rust to TypeScript but not to C++.
# An unknown `type` is dropped without a log, so drift means a desktop that
# cannot type, with clean logs.
#
# Both halves of the browser end are checked, since either alone compiles: the
# channel passes the keymap on, and the receiver reaches the layout engine.
#
# Needs no engine build, like `test-cursor-shapes-agree.sh`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/packages/domicile-protocol/wire/host-messages.jsonl"
CHANNEL="$ROOT/packages/domicile-engine/src/components/domicile/browser/control_channel.cc"
LAYOUT="$ROOT/packages/domicile-engine/src/components/domicile/browser/keyboard_layout.cc"
BINDER="$ROOT/packages/domicile-engine/patches/"

for f in "$FIXTURE" "$CHANNEL" "$LAYOUT"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

fail() {
  echo "  FAIL  $1" >&2
  shift
  for line in "$@"; do echo "        $line" >&2; done
  exit 1
}

# The tag and payload key come from the fixture. `wire.rs` asserts that
# `domicile-protocol` writes these lines byte for byte, so they are serde's.
KEYMAP_LINE="$(grep -c '"type":"keymap"' "$FIXTURE" || true)"
[ "$KEYMAP_LINE" -ge 1 ] || fail \
  "no keymap line in $FIXTURE" \
  "The fixture is what pins the wire; a message with no line in it is a" \
  "message the other two ends are being compared against nothing."

# The payload key, read from that line.
KEY="$(sed -n 's/.*"type":"keymap","\([a-z_]*\)":.*/\1/p' "$FIXTURE" | head -1)"
[ -n "$KEY" ] || fail "cannot read the keymap payload's field name out of $FIXTURE"

# The browser's end: the tag it dispatches on, and the field it reads.
grep -q '\*type == "keymap"' "$CHANNEL" || fail \
  "$CHANNEL does not dispatch on \`keymap\`" \
  "The compositor writes that tag (see $FIXTURE). A tag the browser has no" \
  "arm for is dropped silently, and the symptom is a desktop nobody can" \
  "type into with nothing in either log."

grep -q "FindString(\"$KEY\")" "$CHANNEL" || fail \
  "$CHANNEL does not read the \`$KEY\` field the compositor sends" \
  "An absent field reads as no keymap, and the arm does nothing at all."

# `keymap_sink_` carries the keymap from the IO thread to the UI thread's
# layout engine. Without it the arm parses the message and drops it.
grep -q 'keymap_sink_.Run' "$CHANNEL" || fail \
  "$CHANNEL parses the keymap and hands it to nothing" \
  "The sink is the whole of the crossing: without it the message is read," \
  "understood and thrown away."

# `SetCurrentLayoutFromBuffer` is the only `KeyboardLayoutEngine` member that
# sets an xkb state outside ChromeOS.
grep -q 'SetCurrentLayoutFromBuffer' "$LAYOUT" || fail \
  "$LAYOUT does not call SetCurrentLayoutFromBuffer" \
  "It is the only member of KeyboardLayoutEngine that sets an xkb state on" \
  "a non-ChromeOS build: SetCurrentLayoutByName is NOTIMPLEMENTED() there."

# The binding of `SetProcessKeymap` edits a Chromium file, so it lives in
# `patches/`. It connects the two halves above.
grep -rqs 'SetProcessKeymap' "$BINDER" || fail \
  "no patch binds SetProcessKeymap into the control channel" \
  "The channel takes its keymap sink from the binder, which runs on the UI" \
  "thread the layout engine belongs to. Without that patch the two halves" \
  "above are both correct and never meet."

echo "the keymap's tag, field and both ends of its crossing agree"
