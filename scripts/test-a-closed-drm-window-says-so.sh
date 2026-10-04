#!/usr/bin/env bash
# Checks the patch series makes `DrmWindowHost::Close()` call
# `delegate_->OnClosed()`.
#
# Every other Ozone platform ends `Close()` with `OnClosed()`, which finishes
# the teardown. Upstream's DRM body is empty because ChromeOS never calls it
# (see also `test-drm-window-answers-in-dip.sh`). A views browser on a tty
# does: `DesktopWindowTreeHostPlatform::CloseNow()` destroys the compositor,
# calls `Close()`, and without `OnClosed()` the host is left half-destroyed.
# The next access crashes:
#
#   #4 views::DesktopWindowTreeHostPlatform::CloseNow()     <- compositor() is
#   #5 views::DesktopNativeWidgetAura::~DesktopNativeWidgetAura()   null here
#   #7 views::Widget::~Widget()
#
# The DCHECK that would catch this in `~DesktopWindowTreeHostPlatform` is off
# in release builds:
#
#   DCHECK(!platform_window()) << "The host must be closed before destroying it.";
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# Collect the lines added in place of the empty upstream body, in
# `drm_window_host.cc` hunks only, so `OnClosed()` in another method does not
# count.
body="$(awk '
  /^diff --git a\// { in_file = ($0 ~ /drm_window_host\.cc$/); collecting = 0 }
  !in_file { next }
  /^-void DrmWindowHost::Close\(\) \{\}$/ { collecting = 1; removed = 1; next }
  collecting && /^\+/ { print substr($0, 2); next }
  collecting { collecting = 0 }
  END { exit (removed ? 0 : 1) }
' "$PATCHES"/*.patch 2>/dev/null)" || {
  echo '  FAIL  the empty upstream Close() body is removed'
  echo "    no patch removes: void DrmWindowHost::Close() {}"
  echo "1 failed"
  exit 1
}
echo '  ok    the empty upstream Close() body is removed'

# Removing the body is not enough; the replacement must call `OnClosed()`.
case "$body" in
  (*'delegate_->OnClosed();'*)
    echo '  ok    the new Close() reports the close to its delegate' ;;
  (*)
    echo '  FAIL  the new Close() reports the close to its delegate'
    echo "    the body that replaces it does not call delegate_->OnClosed():"
    printf '%s\n' "$body" | sed 's/^/      /'
    echo "1 failed"
    exit 1 ;;
esac

echo "all ok"
