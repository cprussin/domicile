#!/usr/bin/env bash
# Tests that the DRM platform answers `GetDefaultCursor` with null.
#
# `wm::CursorLoader::CursorFromType` returns the platform factory's answer if
# it is non-null (`ui/wm/core/cursor_loader.cc:194-203`). Only on null does it
# load the arrow from `ui_lottie_resources`, which this binary includes.
#
# `BitmapCursorFactory` never returns null. It returns a cursor with an empty
# bitmap vector, which reaches `drmModeSetCursor(fd, crtc, 0, 0, 0)`. Handle
# zero turns the cursor plane off. The ioctl succeeds, so nothing is logged and
# no pointer is drawn. Ash avoids this by building `wm::CursorLoader` with
# `use_platform_cursors=false`; views uses the default, true.
#
# Needs no Chromium tree: it reads the patch series and `src/`, so it runs in
# the shell group on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
DOMICILE="$ENGINE/src/ui/ozone/platform/drm/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# Domicile-owned files live in `src/`, never in a patch.
for f in drm_cursor_factory.h drm_cursor_factory.cc drm_cursor_factory_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/ozone/platform/drm/domicile"
  fi
done

sources="$(cat "$DOMICILE"/drm_cursor_factory.cc 2>/dev/null || true)"
in_sources() { case "$sources" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# Returning null is what makes `CursorLoader` load the asset.
if in_sources "return nullptr;"; then
  ok "an ordinary cursor type is answered with nothing"
else
  fail "an ordinary cursor type is answered with nothing" \
    "DrmCursorFactory never returns nullptr, so CursorLoader never reaches the assets and the cursor plane stays off"
fi

# `CursorLoader` routes `kNone` through the platform regardless, and
# `DrmCursor` hides on that type. A null for it would draw an arrow.
if in_sources "kNone"; then
  ok "the invisible cursor is still answered"
else
  fail "the invisible cursor is still answered" \
    "no kNone case in DrmCursorFactory; a null there falls back to the pointer, which draws an arrow where a page asked for no cursor"
fi

# The platform must install the factory, or the code above is dead.
if in_patches "std::make_unique<DrmCursorFactory>()"; then
  ok "the DRM platform installs the cursor factory"
else
  fail "the DRM platform installs the cursor factory" \
    "no patch constructs DrmCursorFactory, so ozone_platform_drm.cc still builds a BitmapCursorFactory"
fi

if in_patches "std::make_unique<BitmapCursorFactory>()"; then
  fail "no patch puts the blank-cursor factory back" \
    "a patch constructs BitmapCursorFactory for this platform, which is the bug this replaced"
else
  ok "no patch puts the blank-cursor factory back"
fi

# The test must be registered: otherwise it does not link, and a
# `--gtest_filter` that matches nothing exits zero.
if in_patches '"domicile/drm_cursor_factory_unittest.cc"'; then
  ok "the unit test is in the gbm_unittests target"
else
  fail "the unit test is in the gbm_unittests target" \
    "no patch adds domicile/drm_cursor_factory_unittest.cc to BUILD.gn"
fi

# `scripts/engine-drm-unit-tests.sh` holds the per-suite test count floors.
# Both engine.yml and engine-drm-probe.yml run it.
FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *DrmCursorFactoryTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'DrmCursorFactoryTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
