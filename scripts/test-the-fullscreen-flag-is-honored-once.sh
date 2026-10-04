#!/usr/bin/env bash
# Tests that `--start-fullscreen` reaches the window on the `--app=` path, and
# that it is applied once.
#
# On a tty the window must be the screen. `ScreenManager::FindWindowAt` binds a
# window to a display controller only when its rectangle equals
# `gfx::Rect(controller->origin(), controller->GetModeSize())`. Any other
# window gets no controller, and its frames are dropped without a log.
# `domicile-launch` passes `--start-fullscreen` on the scanout platform
# (`packages/domicile-launch/tests/spawn.rs`) to get that rectangle.
#
# Two things must hold:
#
# - The DRM window handles the request. `DrmWindowHost::SetFullscreen` is `{}`
#   upstream, because ash sizes its own root window.
# - Nothing toggles fullscreen a second time. `FinalizeWebAppLaunch` already
#   ends in `StartupBrowserCreatorImpl::MaybeToggleFullscreen`
#   (`chrome/browser/ui/startup/web_app_startup_utils.cc`). A second toggle
#   exits fullscreen and restores Chromium's default app window size.
#
# Needs no Chromium tree: it reads the patches, so it runs in the shell group
# on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# The replacement body only: `awk` walks `drm_window_host.cc`'s hunks, waits
# for the upstream one-liner's removal, and collects what is added in its
# place. `SetBoundsInPixels` in another method does not count.
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

# The body must move the window; an empty or unrelated body still compiles.
case "$body" in
  (*'SetBoundsInPixels('*)
    echo '  ok    the DRM window answers a fullscreen request with new bounds' ;;
  (*)
    echo '  FAIL  the DRM window answers a fullscreen request with new bounds'
    echo "    the body that replaces it never calls SetBoundsInPixels():"
    printf '%s\n' "$body" | sed 's/^/      /'
    failed=$((failed + 1)) ;;
esac

# Added code, not comments: a comment naming the upstream call is not a second
# caller.
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
