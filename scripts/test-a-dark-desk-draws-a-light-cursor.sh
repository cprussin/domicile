#!/usr/bin/env bash
# A dark desk draws a light pointer.
#
# On a console the pointer is Chromium's own art: `wm::CursorLoader` renders
# the lottie assets in `ui_lottie_resources` (patch 0026 is why it reaches
# them at all), and that art is a black fill in a white outline whatever the
# desk looks like -- a dark arrow on dark panels.
#
# The art takes both colors as parameters, and `wm::GetCursorData` accepts
# both. The loader passes on only the fill, so the patch gives it the outline
# too; `CursorColorScheme` picks the pair from the process's color scheme,
# which is the desk's windows theme (see `test-the-theme-reaches-the-web.sh`);
# and `DesktopNativeCursorManager` is what holds the loader. Any one of the
# three missing compiles and draws the same black arrow.
#
# A nested desktop is not covered and does not need to be: there the loader
# takes the host's cursor theme, and colors only the assets it falls back to.
#
# BUILDLESS ON PURPOSE, like `test-the-theme-reaches-the-web.sh`.
# `cursor_color_scheme_unittest.cc` is the half that asserts the colors, and
# it runs only where an engine builds.
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

# Only the patch is read from here on, because the files it edits are
# Chromium's and are not in this repository.
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
