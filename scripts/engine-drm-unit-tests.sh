#!/usr/bin/env bash
# Runs the DRM platform's gtest cases in ozone_unittests, plus the two evdev
# suites linked there (`ScrollAcceleratorTest` and `WheelTicksTest`; see
# scripts/test-a-fast-scroll-goes-further.sh and
# scripts/test-a-mouse-goes-through-libinput.sh).
#
#   ./scripts/engine-drm-unit-tests.sh        # the suites this fork wrote
#   ./scripts/engine-drm-unit-tests.sh all    # and upstream's, on the probe
#
# Shared by engine.yml and engine-drm-probe.yml so the floors live in one
# place.
#
# One floor per suite: `--gtest_filter` matching nothing exits 0, so a suite
# that stopped linking would otherwise pass. Floors, not exact counts, so
# adding a case does not fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# `all` also runs upstream's cases, which catch the fork breaking
# `OzonePlatformDrm`; the probe uses it. The default runs only the fork's
# suites, which is cheaper.
WHOLE_SUITE="${1:-ours}"
case "$WHOLE_SUITE" in
  (ours|all) ;;
  (*) echo "usage: $(basename "$0") [all]" >&2; exit 2 ;;
esac

SUITES=(
  DrmScreenTest:31
  DrmModesetTest:22
  DrmVtSwitcherTest:18
  DrmSleepTest:2
  DrmFullscreenTest:4
  DrmMasterTest:8
  DrmInputDevicesTest:25
  DrmInputControllerTest:1
  DrmCursorFactoryTest:4
  DrmEdidSerialTest:18
  DrmPointerCrossingTest:20
  ScrollAcceleratorTest:7
  WheelTicksTest:3
)

cd "$ENGINE_OUT"

filter=""
for suite_and_floor in "${SUITES[@]}"; do
  suite="${suite_and_floor%%:*}"
  floor="${suite_and_floor##*:}"
  filter="$filter${filter:+:}$suite.*"
  count=$(./ozone_unittests --gtest_filter="$suite.*" --gtest_list_tests |
    grep -cE '^  ' || true)
  echo "$count $suite cases (floor $floor)"
  [ "$count" -ge "$floor" ] || {
    annotate "only $count $suite cases; the suite was renamed or did not link"
    exit 1
  }
done

if [ "$WHOLE_SUITE" = all ]; then
  ./ozone_unittests
else
  ./ozone_unittests --gtest_filter="$filter"
fi
