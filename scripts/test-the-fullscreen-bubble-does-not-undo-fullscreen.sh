#!/usr/bin/env bash
# Whether the fullscreen exit bubble is allowed to take the desktop back out of
# fullscreen 1.5 seconds after it went in.
#
# THE DESKTOP CAME UP FULL SCREEN AND LEFT AGAIN. A tty run on a 2880x1920
# panel reported a desktop of 2880x1920 and then, 1.37 seconds later, one of
# 1050x1900 -- Chromium's default app window on that panel, which is the
# `restored_bounds_` `DrmWindowHost::SetFullscreen` records on the way in. A
# window that is not EXACTLY the CRTC's rectangle gets no controller out of
# `ScreenManager::FindWindowAt`, so from that moment nothing was drawn at all.
#
# What asks is a watchdog on a window that can never answer it.
# `ExclusiveAccessBubbleViews::Show` arms `presentation_watchdog_timer_` for
# 1500ms and stops it in `OnFirstPresentation`; on timeout it calls
# `ExclusiveAccessManager::ExitExclusiveAccess()`, which for a browser-mode
# fullscreen is `FullscreenController::ExitFullscreenModeInternal()` and ends
# in `BrowserView::ProcessFullscreen(false, ...)`. The bubble is its own
# top-level window -- `SubtleNotificationView::CreatePopupWidget` asks for
# `ui::ZOrderLevel::kSecuritySurface`, and `GetNativeWidgetTypeForInitParams`
# in `chrome_views_delegate_linux.cc` answers a security surface with
# `kDesktopNativeWidgetAura`, always -- so on ozone/drm it is a second window,
# its rectangle is not the CRTC's, `DrmWindow::SchedulePageFlip` takes its
# `if (!controller_)` branch and answers `gfx::PresentationFeedback::Failure()`.
# A failed presentation does not run the successful-presentation callbacks; it
# keeps them pending (`cc/trees/presentation_time_callback_buffer.cc`). So
# `OnFirstPresentation` never runs, the watchdog always fires, and the desktop
# always leaves fullscreen a second and a half after it arrives.
#
# The arm above it in the same function says the same thing about headless, in
# the same words, down to naming `--start-fullscreen` as what it would revert.
# This is that arm's twin: a platform where a window that is not the screen is
# never presented, so nothing may wait on its presentation.
#
# The question belongs to Ozone rather than to the bubble, which is why the
# assertions come in two halves: the bubble has to ASK, and ozone/drm has to
# ANSWER. Either alone is a change that compiles and does nothing.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads the
# patches -- which is what makes it cheap enough to run in the shell group on
# every push rather than only when the fork is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# `awk` over one file's hunks rather than `grep` over the series: a patch that
# says `presents_every_window` in some other file is not this one, and the
# removal is what pins the addition to the watchdog's own condition rather than
# to any line in the bubble.
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

# Half one: the bubble asks. The upstream condition is headless and nothing
# else, so a series that still carries it verbatim has not asked anything.
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

# Dropping the headless arm to make room for the new one would trade one
# spurious exit for another, and it is the easy way to get this wrong.
case "$bubble" in
  (*headless::IsHeadlessMode\(\)*)
    echo '  ok    the headless arm survives beside it' ;;
  (*)
    echo '  FAIL  the headless arm survives beside it'
    echo "    the replacement condition never names headless::IsHeadlessMode(),"
    echo "    so a headless run is back to reverting --start-fullscreen."
    failed=$((failed + 1)) ;;
esac

# Half two: ozone/drm answers. A property nothing sets is a property that reads
# as its default, and the default has to be the answer every other platform
# already gives.
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
