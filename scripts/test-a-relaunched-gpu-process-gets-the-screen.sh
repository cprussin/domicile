#!/usr/bin/env bash
# Whether a GPU process that replaced a dead one can be DRM master.
#
# The browser keeps a `dup` of every card it hands the GPU process (`DrmMaster`,
# patch 0019): the one `struct drm_file` the GPU process draws through, and the
# only one the browser may drop master on. When the GPU process dies its copy
# closes and the browser's does not, so that file stays open AND STAYS MASTER.
#
# `OnGpuProcessLaunched` then opens the card again for the new GPU process. An
# `open` takes master only when the card has none (`drm_master_open`), so this
# one does not; and `drmSetMaster` on it is EACCES, because the kernel lets a
# file that was never master take it only with CAP_SYS_ADMIN. `DrmMaster::Add`
# asks anyway and logs the refusal, then replaces the old dup -- closing the
# last master the card had. The new GPU process is left drawing into a card
# nobody is master of, which is a screen that never comes back:
#
#   GPU process exited unexpectedly: exit_code=134
#   failed to take DRM master on /sys/devices/.../drm/card1: -1
#
# So the browser lets go of every card it held for the dead process before it
# opens one for the new one, next to upstream's own `drm_devices_.clear()`.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads the
# patches, and runs in the shell group on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# Walks `drm_display_host_manager.cc`'s hunks inside `OnGpuProcessLaunched` --
# named by the hunk header or by the signature as a line of the hunk -- and
# answers whether the release is added directly above upstream's
# `drm_devices_.clear()`, which is above the `OpenDrmDevice` that reopens the
# card. Anywhere after the reopen, or in another function, is too late or
# nowhere.
awk '
  /^diff --git a\// { in_file = ($0 ~ /host\/drm_display_host_manager\.cc$/); in_fn = 0; next }
  !in_file { next }
  /^@@/ { in_fn = ($0 ~ /DrmDisplayHostManager::OnGpuProcessLaunched\(\)/); next }
  /^[ +]void DrmDisplayHostManager::OnGpuProcessLaunched\(\) \{$/ { in_fn = 1; next }
  /^[ +]\}$/ { in_fn = 0; next }
  !in_fn { next }
  /^\+ *drm_master_\.ForgetEvery\(\);$/ { released = 1; next }
  released && /^ +drm_devices_\.clear\(\);$/ { ordered = 1 }
  { released = 0 }
  END { exit (ordered ? 0 : 1) }
' "$PATCHES"/*.patch || {
  echo '  FAIL  a relaunched GPU process gets cards nobody is still master of'
  echo "    OnGpuProcessLaunched does not call drm_master_.ForgetEvery() directly above drm_devices_.clear()"
  echo "1 failed"
  exit 1
}
echo '  ok    a relaunched GPU process gets cards nobody is still master of'

echo "all ok"
