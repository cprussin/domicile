#!/usr/bin/env bash
# Whether `--start-fullscreen` reaches the window on the `--app=` path, and
# whether it reaches it ONCE.
#
# ON A TTY THE WINDOW IS THE SCREEN. `ScreenManager::FindWindowAt` binds a
# window to a display controller only when the window's rectangle is EXACTLY
# `gfx::Rect(controller->origin(), controller->GetModeSize())`, so a window
# that is not the CRTC's rect is a window with no controller and every frame
# it submits is dropped before the kernel sees it -- a black screen with
# nothing wrong in any log. `domicile-launch` passes `--start-fullscreen` on
# the scanout platform (`packages/domicile-launch/tests/spawn.rs`) because
# fullscreen is what makes the window that rectangle.
#
# TWO THINGS HAVE TO HOLD, and the series got the second one backwards.
#
# The first is that the DRM window answers the request at all.
# `DrmWindowHost::SetFullscreen` is `{}` upstream, on the premise behind the
# `NOTREACHED()`s `test-drm-window-answers-in-dip.sh` guards: ash sizes its own
# root window, so nothing on ChromeOS asks a DRM window to go fullscreen. A
# views browser on a tty does, and an empty body there is a window that stays
# whatever size it was.
#
# The second is that NOTHING ASKS TWICE. `MaybeLaunchAppShortcutWindow` calls
# `web_app::startup::FinalizeWebAppLaunch`, which ends in
# `StartupBrowserCreatorImpl::MaybeToggleFullscreen(browser)`
# (`chrome/browser/ui/startup/web_app_startup_utils.cc`), which is exactly the
# `--start-fullscreen` handling the flag needs -- so the flag was never being
# dropped on the `--app=` path and the series' own second call was an EXIT:
# `FullscreenController::ToggleFullscreenModeInternal` reads
# `enter_fullscreen = !context->IsFullscreen()`, which the first call had just
# made false. The window went fullscreen and came straight back to
# `restored_bounds_`, which is Chromium's default app window -- 1050x1900 on a
# 2880x1920 panel, the size a real tty run reported as the desktop's.
#
# So this is a negative assertion on purpose: what broke the desktop was an
# addition, and the shape of the bug is a second caller rather than a missing
# one.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads the
# patches -- which is what makes it cheap enough to run in the shell group on
# every push rather than only when the fork is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# The replacement body, read as a body rather than as a line anywhere in the
# file: `awk` walks `drm_window_host.cc`'s hunks only, waits for the removal of
# the upstream one-liner, and collects what is added in its place -- so a patch
# that says `SetBoundsInPixels` in some other method cannot stand in for the
# one method that has to say it.
body="$(awk '
  /^diff --git a\// { in_file = ($0 ~ /drm_window_host\.cc$/); collecting = 0 }
  !in_file { next }
  /^-void DrmWindowHost::SetFullscreen\(bool fullscreen, int64_t target_display_id\) \{\}$/ {
    collecting = 1; removed = 1; next
  }
  collecting && /^\+/ { print substr($0, 2); next }
  collecting { collecting = 0 }
  END { exit (removed ? 0 : 1) }
' "$PATCHES"/*.patch)" || {
  echo '  FAIL  the DRM window answers a fullscreen request'
  echo "    no patch replaces: void DrmWindowHost::SetFullscreen(bool fullscreen, int64_t target_display_id) {}"
  failed=$((failed + 1))
}

# A removal with nothing in its place is the other way to get this wrong, and a
# body that never moves the window is the way that still compiles.
case "$body" in
  (*'SetBoundsInPixels('*)
    echo '  ok    the DRM window answers a fullscreen request with new bounds' ;;
  (*)
    echo '  FAIL  the DRM window answers a fullscreen request with new bounds'
    echo "    the body that replaces it never calls SetBoundsInPixels():"
    printf '%s\n' "$body" | sed 's/^/      /'
    failed=$((failed + 1)) ;;
esac

# Added code rather than added lines: a comment naming the function upstream
# already calls is a comment, and this is about a second caller.
callers="$(awk '
  /^diff --git a\// {
    in_file = ($0 ~ /startup_browser_creator\.cc$/)
    patch = FILENAME
    sub(/.*\//, "", patch)
    next
  }
  !in_file { next }
  /^\+[[:space:]]*\/\// { next }
  /^\+.*ToggleFullscreenMode\(/ { print patch ": " substr($0, 2) }
' "$PATCHES"/*.patch)"

if [ -z "$callers" ]; then
  echo '  ok    the series adds no second fullscreen toggle to startup'
else
  echo '  FAIL  the series adds no second fullscreen toggle to startup'
  echo "    FinalizeWebAppLaunch already ends in MaybeToggleFullscreen, so this"
  echo "    call toggles the window back out of fullscreen:"
  printf '%s\n' "$callers" | sed 's/^/      /'
  failed=$((failed + 1))
fi

[ "$failed" -eq 0 ] || { echo "$failed failed"; exit 1; }
echo "all ok"
