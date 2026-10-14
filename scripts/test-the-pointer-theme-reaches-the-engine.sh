#!/usr/bin/env bash
# Tests that the config's pointer theme reaches the engine's cursor factory.
#
# The compositor writes `cursor` on `appearance`, the control channel hands it
# to `ui::SetDeskCursorTheme` through a sink a patch binds, and the DRM cursor
# factory observes the source that sets. Missing any link still compiles and
# leaves the pointer Chromium's own, with clean logs.
#
# Needs no engine build, like `test-the-keymap-reaches-the-browser.sh`. The
# fork's unit tests cover each link where an engine builds.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/packages/domicile-protocol/wire/host-messages.jsonl"
ENGINE="$ROOT/packages/domicile-engine"
CHANNEL="$ENGINE/src/components/domicile/browser/control_channel.cc"
FACTORY="$ENGINE/src/ui/ozone/platform/drm/domicile/drm_cursor_factory.cc"
BINDER="$ENGINE/patches/"

fail() {
  echo "  FAIL  $1" >&2
  shift
  for line in "$@"; do echo "        $line" >&2; done
  exit 1
}

for f in "$FIXTURE" "$CHANNEL" "$FACTORY"; do
  [ -f "$f" ] || fail "no $f"
done

# The field names come from the fixture, which `wire.rs` pins to serde's.
grep -q '"type":"appearance",.*"cursor":{"name":"[^"]*","size":[0-9]*}' \
  "$FIXTURE" || fail \
  "no appearance line with a cursor {name, size} in $FIXTURE" \
  "The names below are checked against that line."

ARM="$(awk '/\*type == "appearance"/,/^  }$/' "$CHANNEL")"
for read in 'FindDict("cursor")' 'FindString("name")' 'FindInt("size")' \
  'cursor_theme_sink_.Run'; do
  grep -qF "$read" <<<"$ARM" || fail \
    "$CHANNEL's \`appearance\` arm has no $read" \
    "The browser would read no theme, and the pointer stays Chromium's own."
done

grep -rqs 'ui::SetDeskCursorTheme' "$BINDER" || fail \
  "no patch binds ui::SetDeskCursorTheme into the control channel" \
  "The channel's sink comes from the binder, on the UI thread the cursor" \
  "factory belongs to."

grep -q 'observation_.Observe' "$FACTORY" || fail \
  "$FACTORY does not observe the desk's cursor theme" \
  "A theme set after the factory was made would never be loaded."

echo "the pointer theme's field names and every link of its crossing agree"
