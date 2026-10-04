#!/usr/bin/env bash
# Tests `engine-drm-probe-report.sh`, which pulls the reason for a DRM probe
# failure out of its build log.
#
# A probe run takes hours on the Chromium tree, and a bare exit code wastes it.
# A plain tail is not enough: siso prints its spinner and resource table after
# the compiler error.
#
# The logs are synthetic. They reproduce only the shapes the script keys on:
# gn's `ERROR at` block, siso's `stderr:` block and ninja's `FAILED:` line.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="$ROOT/.github/scripts/engine-drm-probe-report.sh"
[ -x "$REPORT" ] || { echo "no $REPORT" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said:\n%s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}
lacks() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  FAIL  %s\n    should not have mentioned: %s\n' \
          "$what" "$needle"; FAILED=$((FAILED + 1)) ;;
    (*) printf '  ok    %s\n' "$what" ;;
  esac
}
expect_within() { # what, how many lines, needle, haystack
  local what="$1" lines="$2" needle="$3" hay="$4"
  case "$(printf '%s\n' "$hay" | sed -n "1,${lines}p")" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    not in the first %s lines: %s\n' \
          "$what" "$lines" "$needle"; FAILED=$((FAILED + 1)) ;;
  esac
}

noise() { # how many lines of the progress spinner and the resource table
  local i=1
  while [ "$i" -le "$1" ]; do
    echo "[$i/9000] CXX obj/ui/ozone/platform/drm/gbm/filler_$i.o"
    i=$((i + 1))
  done
}

# ---- gn refused the arguments ---------------------------------------------
#
# `gn gen` stops on an assert. The report needs the assert's file, line and
# message.
GN="$WORK/gn.log"
{
  echo "Generating files..."
  echo "ERROR at //ui/ozone/platform/drm/BUILD.gn:14:1: Assertion failed."
  echo 'assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")'
  echo "^-----"
  echo "Ozone DRM platform is ChromeOS-only"
  noise 40
} >"$GN"
out="$("$REPORT" "$GN" 2>&1)"
contains "a gn assertion names the file and line" \
  "//ui/ozone/platform/drm/BUILD.gn:14:1" "$out"
contains "and the message inside the assert" \
  "Ozone DRM platform is ChromeOS-only" "$out"
expect_within "and it is at the top, not behind the noise" 25 \
  "//ui/ozone/platform/drm/BUILD.gn:14:1" "$out"

# ---- siso stopped on a compiler error --------------------------------------
#
# siso prints the compiler's message in a `stderr:` block, then about a
# hundred more lines of progress.
SISO="$WORK/siso.log"
{
  noise 120
  echo "FAILED: obj/ui/ozone/platform/drm/gbm/page_flip_watchdog.o"
  echo "../../third_party/llvm-build/Release+Asserts/bin/clang++ -MMD -MF obj/x.o.d -DUSE_OZONE=1 -c ../../ui/ozone/platform/drm/gpu/page_flip_watchdog.cc"
  echo "stderr:"
  echo "../../ui/ozone/platform/drm/gpu/page_flip_watchdog.cc:9:10: fatal error: 'ash/constants/ash_switches.h' file not found"
  echo '    9 | #include "ash/constants/ash_switches.h"'
  echo "      |          ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"
  echo "1 error generated."
  noise 100
  echo "ninja: build stopped: subcommand failed."
  echo "local:1 remote:0 cache:0 fallback:0 retry:0 skip:8123"
  echo "fs: ops: 41234 r:912MB w:3MB"
} >"$SISO"
out="$("$REPORT" "$SISO" 2>&1)"
contains "the compiler's own sentence survives" \
  "fatal error: 'ash/constants/ash_switches.h' file not found" "$out"
contains "with the file and line it was about" \
  "ui/ozone/platform/drm/gpu/page_flip_watchdog.cc:9:10" "$out"
contains "and the object that failed to build" \
  "FAILED: obj/ui/ozone/platform/drm/gbm/page_flip_watchdog.o" "$out"
# The probe should return the answer without a second log fetch, so the
# diagnostic must lead the report.
expect_within "the diagnostic is at the top of the report, not a tail away" 25 \
  "fatal error: 'ash/constants/ash_switches.h' file not found" "$out"
# The tail follows the windows for context.
contains "and the tail follows it for context" "-- the last of" "$out"

# ---- a link failure, which has no `stderr:` block at all --------------------
#
# A `visibility` refusal or undefined symbol is a FAILED: line plus lld's
# message. A report keyed only on compiler `error:` would miss both.
LINK="$WORK/link.log"
{
  noise 60
  echo "FAILED: ozone_unittests"
  echo "ld.lld: error: undefined symbol: ui::DrmScreen::GetAllDisplays() const"
  echo ">>> referenced by ozone_platform_drm.cc"
  noise 80
  echo "ninja: build stopped: subcommand failed."
} >"$LINK"
out="$("$REPORT" "$LINK" 2>&1)"
contains "a link failure names the symbol" \
  "undefined symbol: ui::DrmScreen::GetAllDisplays() const" "$out"
expect_within "and that too is at the top" 25 \
  "undefined symbol" "$out"

# ---- the script never ran at all -------------------------------------------
#
# A report that prints nothing looks like a passing build. It must say it found
# nothing and show the last lines.
#
# This fixture has no `drm probe:` line. engine-drm-probe.sh prints one before
# anything can fail, so its absence means the script never ran. The next case
# covers a probe that ran.
QUIET="$WORK/quiet.log"
{ echo "entering environment"; noise 30; } >"$QUIET"
out="$("$REPORT" "$QUIET" 2>&1)"
contains "a log with no probe output says the script never ran" \
  "nothing in the log looks like a failure" "$out"
contains "and shows the last thing that was said" "filler_30.o" "$out"

# ---- a probe that ran, failed, and used none of the markers -----------------
#
# Once the probe starts, its `drm probe:` lines are always present, so the tail
# must not depend on their absence. A python action that died (here
# `gcc_solink_wrapper.py` raising MemoryError) prints no `FAILED:`, `ERROR at`,
# `stderr:` or `error:`.
RAW="$WORK/raw.log"
{
  echo "depot_tools: /build/depot_tools"
  echo "drm probe: configuring out/DrmProbe"
  echo "drm probe: gn gen accepted ozone_platform_drm = true"
  echo "drm probe: building ui/ozone"
  noise 60
  echo "Traceback (most recent call last):"
  echo '  File "../../build/toolchain/gcc_solink_wrapper.py", line 174, in <module>'
  echo "    sys.exit(main(sys.argv[1:]))"
  echo '  File "../../build/toolchain/gcc_solink_wrapper.py", line 141, in main'
  echo "    tocfile.write(toc)"
  echo "MemoryError"
  echo "drm probe: gn gen accepted the arguments and autoninja could not build ui/ozone"
} >"$RAW"
out="$("$REPORT" "$RAW" 2>&1)"
contains "an unrecognized failure comes back in the tail" "MemoryError" "$out"
contains "with the action that raised it" "gcc_solink_wrapper.py" "$out"
contains "and the probe's own account of how far it got" \
  "drm probe: building ui/ozone" "$out"
# The probe ran, so the report must not say the shell never ran the build.
lacks "and it does not blame the shell for a probe that plainly ran" \
  "so the shell around it did not run the build" "$out"

# A missing log means the previous step never ran; do not treat it as empty.
out="$("$REPORT" "$WORK/absent.log" 2>&1)"
contains "a missing log is named as missing" "$WORK/absent.log" "$out"

# ---- bounded ---------------------------------------------------------------
#
# A real log has hundreds of thousands of lines, so the report must be
# bounded.
BIG="$WORK/big.log"
{ noise 20000; echo "ninja: build stopped: subcommand failed."; } >"$BIG"
lines="$("$REPORT" "$BIG" 2>&1 | wc -l)"
if [ "$lines" -le 200 ]; then
  printf '  ok    %s\n' "a 20000-line log is reported in $lines lines"
else
  printf '  FAIL  %s\n' "a 20000-line log produced $lines lines of report"
  FAILED=$((FAILED + 1))
fi

# ---- a stage after ui/ozone fails -------------------------------------------
#
# The probe builds `ozone_unittests` after `ui/ozone built`, so that line does
# not mean success.
STAGE="$WORK/stage.log"
{
  echo "drm probe: configuring out/DrmProbe"
  echo "drm probe: gn gen accepted ozone_platform_drm = true"
  echo "drm probe: building ui/ozone"
  noise 40
  echo "drm probe: ui/ozone built"
  echo "drm probe: building ozone_unittests"
  noise 40
  echo "FAILED: ozone_unittests"
  echo "ld.lld: error: undefined symbol: ui::DrmScreen::IsScreenSaverActive() const"
  noise 30
  echo "ninja: build stopped: subcommand failed."
} >"$STAGE"
out="$("$REPORT" "$STAGE" 2>&1)"
contains "a failure after ui/ozone names the symbol" \
  "undefined symbol: ui::DrmScreen::IsScreenSaverActive() const" "$out"
contains "and is not treated as a success because ui/ozone built" \
  "-- the last of" "$out"
contains "and says how far the probe got" "drm probe: building ozone_unittests" "$out"

# The same, with nothing for the windows to match.
QUIET="$WORK/quiet-stage.log"
{
  echo "drm probe: configuring out/DrmProbe"
  echo "drm probe: ui/ozone built"
  echo "drm probe: building ozone_unittests"
  noise 40
  echo "MemoryError"
} >"$QUIET"
out="$("$REPORT" "$QUIET" 2>&1)"
contains "a quiet failure after ui/ozone still comes back in the tail" \
  "MemoryError" "$out"

# ---- a clean log ------------------------------------------------------------
#
# The report runs on success too, so a green run can be cited.
OK="$WORK/ok.log"
{
  noise 50
  echo "siso: build finished"
  echo "drm probe: ui/ozone built"
  echo "drm probe: ozone_unittests built"
} >"$OK"
out="$("$REPORT" "$OK" 2>&1)"
contains "a clean log reports the verdict line" "drm probe: ui/ozone built" "$out"
contains "and the last one, which is what says it finished" \
  "drm probe: ozone_unittests built" "$out"
lacks "and invents no failure" "nothing in the log looks like a failure" "$out"
# A tail under a success would read as a failure.
lacks "and a run that got there needs no tail" "-- the last of" "$out"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
