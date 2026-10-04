#!/usr/bin/env bash
# Checks popups (a `<select>` list, a date picker, a context menu, a tooltip)
# are drawn inside their parent window on platforms that present one window
# per display.
#
# Upstream gives page popups and views menus their own top-level window
# (`DesktopNativeWidgetAuraWindowParentingClient::GetDefaultParent` and
# `GetNativeWidgetTypeForInitParams` in `chrome_views_delegate_linux.cc`). On
# ozone/drm a second top-level window has no CRTC, so the popup is open but
# never drawn. The patches check `presents_every_window` in both places and,
# when it is false, make the popup a child of its window, as ash does.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# Prints the lines the series adds to files matching $2.
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

# The check must also return the root window.
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

# A tooltip has only a context, not a parent (`TooltipAura::CreateTooltipWidget`
# sets `params.context` and `force_software_compositing`). As a top-level
# window its software compositor aborts the GPU process on ozone/drm in
# `GbmSurfaceFactory::CreateCanvasForWidget`.
case "$delegate" in
  (*params.context*presents_every_window*)
    echo '  ok    a tooltip, which has only a context, is drawn in its window' ;;
  (*)
    echo '  FAIL  a tooltip, which has only a context, is drawn in its window'
    echo "    nothing the series adds to chrome_views_delegate_linux.cc reads"
    echo "    params.context before presents_every_window, so a tooltip is a"
    echo "    top-level window with a software compositor, and on ozone/drm"
    echo "    that aborts the GPU process."
    failed=$((failed + 1)) ;;
esac

[ "$failed" -eq 0 ] || { echo "$failed failed"; exit 1; }
echo "all ok"
