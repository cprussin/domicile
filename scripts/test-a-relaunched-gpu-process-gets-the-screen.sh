#!/usr/bin/env bash
# Checks a relaunched GPU process can become DRM master.
#
# The browser keeps a `dup` of each card it gives the GPU process
# (`DrmMaster`). When the GPU process dies, the browser's copy stays open and
# stays master. A new `open` takes master only when the card has none, and
# `drmSetMaster` on it fails with EACCES without CAP_SYS_ADMIN.
# `DrmMaster::Add` then replaces the old dup, closing the card's last master,
# so the new GPU process draws to a card nobody is master of and the screen
# stays dark:
#
#   GPU process exited unexpectedly: exit_code=134
#   failed to take DRM master on /sys/devices/.../drm/card1: -1
#
# So `OnGpuProcessLaunched` must release the old cards before reopening them.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# In `drm_display_host_manager.cc`, `OnGpuProcessLaunched` must add
# `drm_master_.ForgetEvery()` directly above upstream's `drm_devices_.clear()`,
# which precedes the `OpenDrmDevice` that reopens the card.
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
