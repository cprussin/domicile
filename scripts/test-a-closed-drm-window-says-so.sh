#!/usr/bin/env bash
# Whether the DRM platform's window reports its own close.
#
# `PlatformWindow::Close()` is not "release the window": it is a request whose
# completion is `PlatformWindowDelegate::OnClosed()`, and every other Ozone
# platform ends `Close()` with that call -- `HeadlessWindow::Close()` is
# nothing else, `WaylandWindow::Close()` is nothing else, `X11Window::Close()`
# tears the X window down and then makes it. `DrmWindowHost::Close()` is `{}`.
#
# On ChromeOS that is harmless, because ash never routes a window through
# `DesktopWindowTreeHostPlatform` and nothing ever calls it -- the same premise
# as the seven `NOTREACHED()`s in `test-drm-window-answers-in-dip.sh`, which is
# this guard's sibling and was written for the same species of bug.
#
# A views browser on a tty does call it, and the silence is a SEGV. The order
# in `DesktopWindowTreeHostPlatform::CloseNow()` is: destroy the compositor,
# then `platform_window()->Close()`. `OnClosed()` is what nulls the platform
# window and finishes the teardown, so with no `OnClosed()` the host is left
# half-destroyed -- compositor gone, platform window alive -- and the next
# thing to touch it walks into a destroyed compositor:
#
#   #4 views::DesktopWindowTreeHostPlatform::CloseNow()     <- compositor() is
#   #5 views::DesktopNativeWidgetAura::~DesktopNativeWidgetAura()   null here
#   #7 views::Widget::~Widget()
#
# Upstream states the invariant that the empty body breaks, one line into
# `~DesktopWindowTreeHostPlatform`:
#
#   DCHECK(!platform_window()) << "The host must be closed before destroying it.";
#
# The release build sets `dcheck_always_on = false`, so the assertion that
# would have named this is compiled out and what is left is the crash.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads the
# patches -- which is what makes it cheap enough to run in the shell group on
# every push rather than only when the fork is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# The replacement body, read as a body rather than as a line anywhere in the
# file. `awk` walks `drm_window_host.cc`'s hunks only, waits for the removal of
# the upstream one-liner, and collects what is added in its place -- so a patch
# that says `delegate_->OnClosed()` in some other method cannot stand in for
# the one method that has to say it.
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

# A removal with nothing in its place is the other way to get this wrong, and
# it is the one a "the NOTREACHED is gone" style check would pass.
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
