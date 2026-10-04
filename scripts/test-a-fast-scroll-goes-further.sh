#!/usr/bin/env bash
# Checks two-finger scrolling on a tty goes through `ScrollAccelerator`.
#
# The curve lives in `src/ui/events/ozone/evdev/domicile/scroll_accelerator.cc`.
# A patch makes the libinput converter call it and adds it to the build.
# Without either, scrolling is silently unaccelerated.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
DOMICILE="$ENGINE/src/ui/events/ozone/evdev/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

for f in scroll_accelerator.h scroll_accelerator.cc scroll_accelerator_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/events/ozone/evdev/domicile"
  fi
done

if in_patches "scroll_accelerator_.Scroll("; then
  ok "the libinput converter scrolls through the accelerator"
else
  fail "the libinput converter scrolls through the accelerator" \
    "no patch calls scroll_accelerator_.Scroll, so HandlePointerAxis dispatches libinput's deltas as they come"
fi

if in_patches '"domicile/scroll_accelerator.cc"'; then
  ok "the accelerator is in the evdev component"
else
  fail "the accelerator is in the evdev component" \
    "no patch adds domicile/scroll_accelerator.cc to ui/events/ozone/evdev/BUILD.gn"
fi

# An unregistered test is not linked, and a `--gtest_filter` matching nothing
# exits zero.
if in_patches '"//ui/events/ozone/evdev/domicile/scroll_accelerator_unittest.cc"'; then
  ok "the unit test is in ozone_unittests"
else
  fail "the unit test is in ozone_unittests" \
    "no patch adds scroll_accelerator_unittest.cc to ui/ozone/platform/drm/BUILD.gn"
fi

FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *ScrollAcceleratorTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'ScrollAcceleratorTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
