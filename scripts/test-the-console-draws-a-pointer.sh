#!/usr/bin/env bash
# Whether the DRM platform answers `GetDefaultCursor` with nothing.
#
# NOTHING IS THE USEFUL ANSWER, AND THAT IS THE WHOLE OF THIS.
# `wm::CursorLoader::CursorFromType` asks the platform's factory first and
# returns any non-null answer (`ui/wm/core/cursor_loader.cc:194-203`), so the
# arrow in `ui_lottie_resources` -- which IS in this binary, gated on
# `use_aura` rather than on ChromeOS -- is loaded by `LoadCursorFromAsset` on
# the next line only when the platform answers nothing.
#
# `BitmapCursorFactory` never answers nothing: it hands back a cursor carrying
# the type and an empty bitmap vector. That vector reaches
# `drmModeSetCursor(fd, crtc, 0, 0, 0)`, and handle zero is the kernel's word
# for turning the cursor plane off. The ioctl succeeds, so nothing is logged
# and a desktop that tracks the pointer draws none.
#
# ash has the same factory and not the same bug: its `wm::CursorLoader` is
# built with `use_platform_cursors=false`, and views' takes that parameter's
# default, which is true. Anything that puts `BitmapCursorFactory` back here
# puts the blank cursor back with it, in silence -- hence a guard rather than
# a comment.
#
# NO CHROMIUM TREE. The series and `src/` are the source of truth, so this
# runs in the shell group on every push.
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

# The Domicile-owned half lives in `src/`, never in a patch: a file is in one
# or the other and never both.
for f in drm_cursor_factory.h drm_cursor_factory.cc drm_cursor_factory_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/ozone/platform/drm/domicile"
  fi
done

sources="$(cat "$DOMICILE"/drm_cursor_factory.cc 2>/dev/null || true)"
in_sources() { case "$sources" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# The null, which is the entire mechanism.
if in_sources "return nullptr;"; then
  ok "an ordinary cursor type is answered with nothing"
else
  fail "an ordinary cursor type is answered with nothing" \
    "DrmCursorFactory never returns nullptr, so CursorLoader never reaches the assets and the cursor plane stays off"
fi

# And the one exception, which is not decoration: `CursorLoader` routes
# `kNone` through the platform whatever the flag says, and `DrmCursor` hides
# on the type. A null for it draws an arrow where something asked for none.
if in_sources "kNone"; then
  ok "the invisible cursor is still answered"
else
  fail "the invisible cursor is still answered" \
    "no kNone case in DrmCursorFactory; a null there falls back to the pointer, which draws an arrow where a page asked for no cursor"
fi

# The platform has to actually install it, or all of the above is dead code.
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

# Registered, or it does not link and a `--gtest_filter` matching nothing
# exits zero -- the silent pass both workflows' floors exist to refuse.
if in_patches '"domicile/drm_cursor_factory_unittest.cc"'; then
  ok "the unit test is in the gbm_unittests target"
else
  fail "the unit test is in the gbm_unittests target" \
    "no patch adds domicile/drm_cursor_factory_unittest.cc to BUILD.gn"
fi

# THE FLOOR, WHICH HAS ONE HOME NOW. It used to be written in both
# engine.yml and engine-drm-probe.yml, and this asserted it was in each —
# which is the check that noticed nothing when the two copies parted
# (`DrmScreenTest:26` against `:18`, and this suite missing from one of
# them altogether). `scripts/engine-drm-unit-tests.sh` is the one list, and
# both jobs run it, so there is one thing to assert and the filter that
# runs is derived from the same array rather than written beside it.
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
