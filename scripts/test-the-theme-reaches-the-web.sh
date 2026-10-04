#!/usr/bin/env bash
# Tests that the desktop's theme reaches pages in its browser windows.
#
# The compositor writes `{"type":"theme",...}` to the chrome socket, and
# `ControlChannel::DispatchLine` passes it to the shell's page. A site's
# `prefers-color-scheme` comes from the engine's `ui::NativeTheme`, which
# `color_scheme.cc` sets. As with the keymap, this needs two halves in the
# fork's files and one line in a Chromium file. Missing any one still
# compiles.
#
# Needs no engine build, like `test-the-keymap-reaches-the-browser.sh`.
# `color_scheme_unittest.cc` tests the override itself where an engine builds.
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

# The `windows_theme` arm passes the theme on, not the `theme` arm. The chrome
# is updated first, and windows (including sites) only after every chrome has
# captured the frame its wipe transition starts from. Updating sites on
# `theme` would put them in that frame already changed.
awk '/\*type == "windows_theme"/,/^  }$/' "$CHANNEL" | grep -q 'theme_sink_.Run' || fail \
  "$CHANNEL's \`windows_theme\` arm does not run theme_sink_" \
  "The page hears the theme; the engine's NativeTheme does not, and every" \
  "site keeps the scheme the process started with."
if awk '/\*type == "theme"/,/^  }$/' "$CHANNEL" | grep -q 'theme_sink_.Run'; then
  fail \
    "$CHANNEL's \`theme\` arm runs theme_sink_" \
    "Sites would turn before the shell captured its old frame, and the wipe" \
    "would pass over them already turned."
fi

grep -q 'SetPreferredColorSchemeOverride' "$SCHEME" || fail \
  "$SCHEME does not call NativeTheme::SetPreferredColorSchemeOverride" \
  "It is the process-wide override every NativeTheme observing the OS" \
  "settings reads, and so what a page's prefers-color-scheme comes from."

grep -rqs 'SetProcessColorScheme' "$BINDER" || fail \
  "no patch binds SetProcessColorScheme into the control channel" \
  "The channel takes its theme sink from the binder, which runs on the UI" \
  "thread NativeTheme belongs to. Without it the two halves never meet."

echo "the theme's crossing into the engine's color scheme is whole"
