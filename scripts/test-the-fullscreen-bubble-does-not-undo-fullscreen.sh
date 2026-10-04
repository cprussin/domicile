#!/usr/bin/env bash
# Tests that the fullscreen exit bubble cannot take the desktop out of
# fullscreen 1.5 seconds after it enters.
#
# `ExclusiveAccessBubbleViews::Show` arms `presentation_watchdog_timer_` for
# 1500ms and stops it in `OnFirstPresentation`. On timeout it exits fullscreen
# and the window returns to its `restored_bounds_`. A window that is not the
# CRTC's rectangle gets no controller from `ScreenManager::FindWindowAt`, so
# nothing is drawn after that.
#
# The bubble is its own top-level window (a security surface, which is always
# `kDesktopNativeWidgetAura`). On ozone/drm it is not the CRTC's rectangle, so
# `DrmWindow::SchedulePageFlip` returns `gfx::PresentationFeedback::Failure()`.
# A failed presentation leaves the success callbacks pending
# (`cc/trees/presentation_time_callback_buffer.cc`), so the watchdog always
# fires. Upstream already skips the watchdog for headless for the same reason.
#
# The fix has two halves: the bubble asks Ozone whether every window is
# presented, and ozone/drm answers no. Either alone does nothing.
#
# Needs no Chromium tree: it reads the patches, so it runs in the shell group
# on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# Scans one file's hunks, not the whole series: `presents_every_window` in
# another file does not count. The removal check ties the addition to the
# watchdog's condition.
added_in() {
  awk -v want="$2" '
    /^diff --git a\// { in_file = ($0 ~ want) }
    !in_file { next }
    /^\+\+\+ / { next }
    /^\+/ { print substr($0, 2) }
  ' "$1"/*.patch
}

removes_in() {
  awk -v want="$2" -v line="$3" '
    /^diff --git a\// { in_file = ($0 ~ want) }
    !in_file { next }
    substr($0, 2) == line && substr($0, 1, 1) == "-" { found = 1 }
    END { exit (found ? 0 : 1) }
  ' "$1"/*.patch
}

# The bubble asks. The upstream condition checks headless only, so a series
# that keeps it verbatim has not asked.
if removes_in "$PATCHES" 'exclusive_access_bubble_views[.]cc$' \
  '  if (!headless::IsHeadlessMode()) {'; then
  echo '  ok    the watchdog is no longer armed on the headless answer alone'
else
  echo '  FAIL  the watchdog is no longer armed on the headless answer alone'
  echo "    no patch replaces: if (!headless::IsHeadlessMode()) {"
  echo "    in exclusive_access_bubble_views.cc, so the 1500ms timer still"
  echo "    fires on every platform that presents only one window."
  failed=$((failed + 1))
fi

bubble="$(added_in "$PATCHES" 'exclusive_access_bubble_views[.]cc$')"

case "$bubble" in
  (*presents_every_window*)
    echo '  ok    the bubble asks the platform whether its window is ever presented' ;;
  (*)
    echo '  FAIL  the bubble asks the platform whether its window is ever presented'
    echo "    nothing the series adds to exclusive_access_bubble_views.cc reads"
    echo "    presents_every_window, so the watchdog is armed without knowing"
    echo "    whether an answer can arrive."
    failed=$((failed + 1)) ;;
esac

# Dropping the headless arm would bring back the exit for headless runs.
case "$bubble" in
  (*headless::IsHeadlessMode\(\)*)
    echo '  ok    the headless arm survives beside it' ;;
  (*)
    echo '  FAIL  the headless arm survives beside it'
    echo "    the replacement condition never names headless::IsHeadlessMode(),"
    echo "    so a headless run is back to reverting --start-fullscreen."
    failed=$((failed + 1)) ;;
esac

# ozone/drm answers. An unset property reads as its default, which must match
# what every other platform gives.
drm="$(added_in "$PATCHES" 'ozone_platform_drm[.]cc$')"

case "$drm" in
  (*presents_every_window*false*)
    echo '  ok    ozone/drm says a window that is not the screen is never presented' ;;
  (*)
    echo '  FAIL  ozone/drm says a window that is not the screen is never presented'
    echo "    nothing the series adds to ozone_platform_drm.cc sets"
    echo "    presents_every_window to false, so the platform that has the"
    echo "    problem is the one platform that does not say so."
    failed=$((failed + 1)) ;;
esac

[ "$failed" -eq 0 ] || { echo "$failed failed"; exit 1; }
echo "all ok"
