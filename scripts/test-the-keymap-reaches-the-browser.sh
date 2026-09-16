#!/usr/bin/env bash
# The keymap crosses a socket into a language that cannot be compiled here.
#
# The compositor compiles one keymap from `input.keyboard` and writes it to the
# chrome control socket as `{"type":"keymap","keymap":"..."}`. The reader is
# the browser process -- `ControlChannel::DispatchLine` in the engine fork --
# and what it does with it is the only thing that ever gives a DRM/Ozone
# browser a keyboard layout at all. See
# `packages/domicile-engine/src/components/domicile/browser/keyboard_layout.h`.
#
# THE TWO ENDS ARE SPELLED SEPARATELY AND NOTHING COMPARED THEM. serde derives
# the tag and the field name from the Rust enum; the C++ writes both as string
# literals. `wire/host-messages.jsonl` pins the Rust half and
# `chrome-sdk`'s schema reads it, so Rust and TypeScript are tied together --
# the C++ is in neither test, and it is the end that matters, because the page
# is never sent this message at all.
#
# What drift costs is silence. A `type` the browser does not know falls off the
# end of `DispatchLine` and is dropped without a line in the log, so the
# symptom is a shell that types nothing while every log on both sides says the
# desktop is fine. That is exactly the failure this whole message exists to
# end, arriving by the other door.
#
# AND BOTH HALVES OF THE BROWSER'S END, because either alone compiles and does
# nothing: the channel has to hand the keymap on, and what it is handed to has
# to reach the layout engine.
#
# BUILDLESS ON PURPOSE, like `test-cursor-shapes-agree.sh`. The alternative is
# a ~50 minute engine build on the one runner that can do it, and a session
# without a Chromium checkout cannot run that at any price.
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

# The wire, from the fixture rather than from this script: `wire.rs` asserts
# byte for byte that `domicile-protocol` writes these lines, so the tag and the
# payload key here are serde's own and not a third spelling to keep in step.
KEYMAP_LINE="$(grep -c '"type":"keymap"' "$FIXTURE" || true)"
[ "$KEYMAP_LINE" -ge 1 ] || fail \
  "no keymap line in $FIXTURE" \
  "The fixture is what pins the wire; a message with no line in it is a" \
  "message the other two ends are being compared against nothing."

# The payload key, read off that line rather than assumed.
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

# And that the arm leads somewhere. `keymap_sink_` is what carries it off the
# IO thread to the UI thread's layout engine; a `keymap` arm that parses the
# message and drops it would pass every check above.
grep -q 'keymap_sink_.Run' "$CHANNEL" || fail \
  "$CHANNEL parses the keymap and hands it to nothing" \
  "The sink is the whole of the crossing: without it the message is read," \
  "understood and thrown away."

# The other half of that crossing. `SetCurrentLayoutFromBuffer` is the one
# member of `KeyboardLayoutEngine` that sets an xkb state off ChromeOS; a
# keyboard_layout.cc that called anything else would compile and leave the
# state null.
grep -q 'SetCurrentLayoutFromBuffer' "$LAYOUT" || fail \
  "$LAYOUT does not call SetCurrentLayoutFromBuffer" \
  "It is the only member of KeyboardLayoutEngine that sets an xkb state on" \
  "a non-ChromeOS build: SetCurrentLayoutByName is NOTIMPLEMENTED() there."

# And that the browser is actually wired to hand `SetProcessKeymap` in. That
# edit is to a file Chromium owns, so it lives in `patches/` rather than in
# `src/`, and it is the line that turns two working halves into one path.
grep -rqs 'SetProcessKeymap' "$BINDER" || fail \
  "no patch binds SetProcessKeymap into the control channel" \
  "The channel takes its keymap sink from the binder, which runs on the UI" \
  "thread the layout engine belongs to. Without that patch the two halves" \
  "above are both correct and never meet."

echo "the keymap's tag, field and both ends of its crossing agree"
