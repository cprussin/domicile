#!/usr/bin/env bash
# Checks a dark theme gets a light pointer on a tty.
#
# On a tty, `wm::CursorLoader` draws Chromium's lottie cursors, which default
# to a black fill with a white outline. Three pieces recolor them:
#
# - `CursorColorScheme` picks fill and outline from the theme (see
#   `test-the-theme-reaches-the-web.sh`).
# - A patch to `cursor_loader.cc` passes the outline to `wm::GetCursorData`.
# - A patch to `DesktopNativeCursorManager` gives its loader the scheme.
#
# Missing any one still compiles and draws a black arrow. Nested desktops use
# the host's cursor theme and are not covered.
#
# Needs no engine build. `cursor_color_scheme_unittest.cc` checks the colors.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
SCHEME="$ENGINE/src/ui/views/widget/desktop_aura/domicile/cursor_color_scheme.cc"
PATCHES="$ENGINE/patches"

fail() {
  echo "  FAIL  $1" >&2
  shift
  for line in "$@"; do echo "        $line" >&2; done
  exit 1
}

[ -f "$SCHEME" ] || fail \
  "no $SCHEME" \
  "Nothing chooses the pointer's colors, so a dark desk draws a black arrow."

grep -q 'SK_ColorWHITE' "$SCHEME" || fail \
  "$SCHEME never picks a white fill" \
  "A dark desk would keep the black arrow."

# The remaining files are Chromium's, so read the patches.
LOADER="$(grep -l 'ui/wm/core/cursor_loader.cc' "$PATCHES"/*.patch)"
[ -n "$LOADER" ] || fail \
  "no patch edits ui/wm/core/cursor_loader.cc" \
  "Without it the loader has no outline to pass on, and a white fill sits" \
  "in the art's white outline: an arrow with no edge on a light window."
grep -q '^+.*outline_color_' $LOADER || fail \
  "the patch to cursor_loader.cc adds no outline_color_" \
  "wm::GetCursorData takes an outline; nothing hands it one."

MANAGER="$(grep -l 'desktop_native_cursor_manager.cc' "$PATCHES"/*.patch)"
[ -n "$MANAGER" ] || fail \
  "no patch edits desktop_native_cursor_manager.cc" \
  "It holds the loader a views browser draws with; nothing else can recolor it."
grep -q '^+.*CursorColorScheme' $MANAGER || fail \
  "DesktopNativeCursorManager holds no CursorColorScheme" \
  "The colors are chosen and never reach the loader."

echo "a dark desk's pointer is light"
