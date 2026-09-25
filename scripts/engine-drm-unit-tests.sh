#!/usr/bin/env bash
# The DRM platform's own gtest cases in ozone_unittests.
#
#   ./scripts/engine-drm-unit-tests.sh        # the suites this fork wrote
#   ./scripts/engine-drm-unit-tests.sh all    # and upstream's, on the probe
#
# THE FLOORS BELOW WERE WRITTEN TWICE AND THE COPIES HAD PARTED, which is the
# whole argument for this file existing. `engine.yml` carried one list and
# `engine-drm-probe.yml` another; they disagreed on `DrmScreenTest` — 26
# against 18 — and the probe's had no `DrmEdidSerialTest` at all. Both were
# right the day they were written. Neither could be run outside CI, so nothing
# but CI could notice. The numbers here are the newer list's, which is the one
# that has been kept up with the cases that landed.
#
# ONE FLOOR PER SUITE. A floor over the total would let one suite's cases pay
# for another's disappearance, and `--gtest_filter` matching nothing exits 0,
# so a suite that stopped linking is otherwise a silent pass. Each is a floor
# rather than an equality, so adding a case does not fail the job.
#
# These ran nowhere a pull request could see until recently, and that was not
# an oversight: the dev build named only wayland and headless, so DrmScreenTest
# and DrmModesetTest were not in any binary it produced and could not be.
# `ozone_platform_drm = true` changed that, and a test that runs on demand is a
# test that runs after the change that broke it has already landed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# Everything, or only ours. The probe runs the whole suite because `DrmScreen`
# is reached through `OzonePlatformDrm` and upstream's own cases over that
# platform are what would catch us breaking it from underneath; the dev build
# runs ours because the rest is upstream's business and this is the cheap one.
# The two jobs ask different questions.
WHOLE_SUITE="${1:-ours}"
case "$WHOLE_SUITE" in
  (ours|all) ;;
  (*) echo "usage: $(basename "$0") [all]" >&2; exit 2 ;;
esac

SUITES=(
  DrmScreenTest:29
  DrmModesetTest:22
  DrmVtSwitcherTest:18
  DrmSleepTest:2
  DrmFullscreenTest:4
  DrmMasterTest:7
  DrmInputDevicesTest:25
  DrmInputControllerTest:1
  DrmCursorFactoryTest:4
  DrmEdidSerialTest:18
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
