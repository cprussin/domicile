#!/usr/bin/env bash
# Whether a popup -- a `<select>`'s list, a date picker, a context menu -- is
# drawn inside the window it opened over, on a platform that presents only one
# window per display.
#
# NOTHING OPENED. Clicking a `<select>` on a tty did nothing visible. The list
# is a page popup: `RenderWidgetHostViewAura::InitAsPopup` makes an aura window
# of `WINDOW_TYPE_MENU` and hands it to `ParentWindowWithContext`, and
# `DesktopNativeWidgetAuraWindowParentingClient::GetDefaultParent` answers a
# menu with a top-level widget of its own. A views menu goes the same way from
# the other end: `GetNativeWidgetTypeForInitParams` in
# `chrome_views_delegate_linux.cc` answers `TYPE_MENU` and `TYPE_TOOLTIP` with
# `kDesktopNativeWidgetAura` even when they have a parent. On ozone/drm a second
# top-level window binds to no CRTC -- patch 0023 says why -- so every frame it
# submits is dropped, and the popup is open, focused and invisible.
#
# ChromeOS never meets this because ash keeps menus inside the root window.
# That is what the fix does, on the platforms that say they need it: both
# places ask `presents_every_window`, and where the answer is no a menu becomes
# a child of the window it belongs to and is drawn in that window's frame.
#
# NO CHROMIUM TREE. Like test-the-fullscreen-bubble-does-not-undo-fullscreen.sh,
# this reads the series rather than a build, so it runs on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# The lines the series adds to one file, and nothing from any other.
added_in() {
  awk -v want="$2" '
    /^diff --git a\// { in_file = ($0 ~ want) }
    !in_file { next }
    /^\+\+\+ / { next }
    /^\+/ { print substr($0, 2) }
  ' "$1"/*.patch
}

parenting="$(added_in "$PATCHES" 'desktop_native_widget_aura[.]cc$')"

case "$parenting" in
  (*presents_every_window*)
    echo '  ok    a page popup asks the platform before taking a window of its own' ;;
  (*)
    echo '  FAIL  a page popup asks the platform before taking a window of its own'
    echo "    nothing the series adds to desktop_native_widget_aura.cc reads"
    echo "    presents_every_window, so GetDefaultParent still gives every menu"
    echo "    a top-level window, and on ozone/drm that window is never drawn."
    failed=$((failed + 1)) ;;
esac

# Asking is not enough: the answer has to keep the menu in the root window.
case "$parenting" in
  (*"return root_window_;"*)
    echo '  ok    where it cannot have one, the popup stays in its root window' ;;
  (*)
    echo '  FAIL  where it cannot have one, the popup stays in its root window'
    echo "    the series never adds a return of root_window_ to"
    echo "    desktop_native_widget_aura.cc, so the answer changes nothing."
    failed=$((failed + 1)) ;;
esac

delegate="$(added_in "$PATCHES" 'chrome_views_delegate_linux[.]cc$')"

case "$delegate" in
  (*presents_every_window*kNativeWidgetAura*)
    echo '  ok    a views menu with a parent is drawn in its parent' ;;
  (*)
    echo '  FAIL  a views menu with a parent is drawn in its parent'
    echo "    nothing the series adds to chrome_views_delegate_linux.cc reads"
    echo "    presents_every_window and answers kNativeWidgetAura, so a menu"
    echo "    or tooltip with a parent is still a top-level window of its own."
    failed=$((failed + 1)) ;;
esac

[ "$failed" -eq 0 ] || { echo "$failed failed"; exit 1; }
echo "all ok"
