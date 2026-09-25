#!/usr/bin/env bash
# The desktop's theme reaches the pages in its browser windows.
#
# The compositor writes `{"type":"theme",...}` to the chrome socket, and
# `ControlChannel::DispatchLine` hands it to the shell's page. That repaints
# the panels. It does not repaint a site: a page's `prefers-color-scheme` is
# the engine's own `ui::NativeTheme`, and nothing told it -- so a toggle turned
# the desk over and left every website the way it was.
#
# `color_scheme.cc` is what tells it, and like the keymap's crossing it is two
# halves in the fork's own files and a line in a file Chromium owns. Any one of
# the three missing compiles and does nothing.
#
# BUILDLESS ON PURPOSE, like `test-the-keymap-reaches-the-browser.sh`.
# `color_scheme_unittest.cc` is the half that asserts the override itself, and
# it runs only where an engine builds.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL="$ROOT/packages/domicile-engine/src/components/domicile/browser/control_channel.cc"
SCHEME="$ROOT/packages/domicile-engine/src/components/domicile/browser/color_scheme.cc"
BINDER="$ROOT/packages/domicile-engine/patches/"

fail() {
  echo "  FAIL  $1" >&2
  shift
  for line in "$@"; do echo "        $line" >&2; done
  exit 1
}

[ -f "$CHANNEL" ] || fail "no $CHANNEL"
[ -f "$SCHEME" ] || fail \
  "no $SCHEME" \
  "Nothing sets the engine's color scheme, so a site's prefers-color-scheme" \
  "never follows the desktop's theme."

# The channel's `theme` arm hands the theme on, not only to the page.
awk '/\*type == "theme"/,/^  }$/' "$CHANNEL" | grep -q 'theme_sink_.Run' || fail \
  "$CHANNEL's \`theme\` arm does not run theme_sink_" \
  "The page hears the theme; the engine's NativeTheme does not, and every" \
  "site keeps the scheme the process started with."

grep -q 'SetPreferredColorSchemeOverride' "$SCHEME" || fail \
  "$SCHEME does not call NativeTheme::SetPreferredColorSchemeOverride" \
  "It is the process-wide override every NativeTheme observing the OS" \
  "settings reads, and so what a page's prefers-color-scheme comes from."

grep -rqs 'SetProcessColorScheme' "$BINDER" || fail \
  "no patch binds SetProcessColorScheme into the control channel" \
  "The channel takes its theme sink from the binder, which runs on the UI" \
  "thread NativeTheme belongs to. Without it the two halves never meet."

echo "the theme's crossing into the engine's color scheme is whole"
