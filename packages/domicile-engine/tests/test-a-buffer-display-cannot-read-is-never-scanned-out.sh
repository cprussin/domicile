#!/usr/bin/env bash
# Checks the DRM platform puts no buffer without `GBM_BO_USE_SCANOUT` on a
# plane, and says so once instead of aborting.
#
# Such a buffer has no framebuffer. Upstream `GbmPixmap::ScheduleOverlayPlane`
# only DCHECKs the flag, so the checked engine aborts the GPU process on the
# first frame:
#
#   gbm_pixmap.cc:79] DCHECK failed: buffer_->GetFlags() & GBM_BO_USE_SCANOUT.
#
# `OzoneImageBackingFactory` makes one when a scanout allocation fails, and
# patch 0005 when it imports a client's buffer for sampling only. So
# `ScheduleOverlayPlane` warns once per format, size and modifier and returns
# true without queuing a plane. Returning false would fail every frame and can loop GPU-process
# restarts.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
TEST="$ENGINE/src/ui/ozone/platform/drm/domicile/gbm_pixmap_scanout_unittest.cc"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# In `gbm_pixmap.cc`, the DCHECK goes, and an added `if` on the same flag warns
# once per kind of buffer (`FirstSkipOfItsKind`) and returns true.
if awk '
  /^diff --git a\// { in_file = ($0 ~ /gpu\/gbm_pixmap\.cc$/); guarded = 0; next }
  !in_file { next }
  /^- *DCHECK\(buffer_->GetFlags\(\) & GBM_BO_USE_SCANOUT\);$/ { dropped = 1; next }
  /^\+ *if \(!\(buffer_->GetFlags\(\) & GBM_BO_USE_SCANOUT\)\) \{$/ { guarded = 1; next }
  guarded && /^\+ *if \(FirstSkipOfItsKind\(\*buffer_\)\) \{$/ { once = 1; next }
  once && /^\+ *LOG\(WARNING\) << "Not scanning out a "$/ { logged = 1 }
  once && /^\+    \}$/ { once = 0; next }
  guarded && /^\+ *return false;$/ { failed = 1 }
  guarded && /^\+ *return true;$/ { skipped = 1 }
  /^\+  \}$/ { guarded = 0 }
  END { exit (dropped && logged && skipped && !failed ? 0 : 1) }
' "$PATCHES"/*.patch; then
  ok "a buffer display cannot read is never scanned out"
else
  fail "a buffer display cannot read is never scanned out" \
    "GbmPixmap::ScheduleOverlayPlane does not log once and skip a buffer without GBM_BO_USE_SCANOUT"
fi

if [ -f "$TEST" ]; then
  ok "domicile/gbm_pixmap_scanout_unittest.cc exists"
else
  fail "domicile/gbm_pixmap_scanout_unittest.cc exists" \
    "no such file under src/ui/ozone/platform/drm/domicile"
fi

# An unregistered test is not linked, and a `--gtest_filter` matching nothing
# exits zero.
if cat "$PATCHES"/*.patch | grep -qF '+    "domicile/gbm_pixmap_scanout_unittest.cc",'; then
  ok "the unit test is in ozone_unittests"
else
  fail "the unit test is in ozone_unittests" \
    "no patch adds gbm_pixmap_scanout_unittest.cc to ui/ozone/platform/drm/BUILD.gn"
fi

FLOORS="$ROOT/packages/domicile-engine/scripts/drm-unit-tests.sh"
if grep -qE "^ *GbmPixmapScanoutTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'GbmPixmapScanoutTest:<n>' in packages/domicile-engine/scripts/drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
