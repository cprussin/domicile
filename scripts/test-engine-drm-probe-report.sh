#!/usr/bin/env bash
# The DRM probe's one job is to say WHY, and this is what checks that it does.
#
# The probe exists because a static read of ui/ozone/platform/drm cannot see a
# header that is is_chromeos-conditional three targets down, or a `visibility`
# refusal, or a symbol that only fails at link. Every one of those is a
# sentence in a log. A probe run that ends `Process completed with exit code 1`
# has spent a slot on the single-writer Chromium tree — hours of queue behind
# whatever else holds it — and brought back nothing, which is worse than not
# running it, because it looks like an answer.
#
# So the reporting is the part with a test. It is also the part that is easy to
# get wrong in the direction that hurts: `tail -25` was measured catching the
# tail of siso's progress spinner and its resource table, with the compiler
# error a hundred lines above it. See the Build step in .github/workflows/engine.yml,
# which carries the same scar.
#
# Synthetic logs, because the real ones cost four hours and a runner with a 97G
# checkout. What is synthesised here is only the SHAPE — gn's `ERROR at` block,
# siso's `stderr:` block, ninja's `FAILED:` line — and the shape is the whole of
# what the script keys on.
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
# The first thing that can go wrong and the cheapest: `gn gen` stops on an
# assert before a single translation unit is compiled. What a reader needs is
# the file and line of the assert and the message inside it — the three lines
# gn prints and nothing else in the log has.
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
# THE CASE THIS SCRIPT EXISTS FOR. siso prints the compiler's own words in a
# `stderr:` block, and then carries on printing the steps that were already in
# flight, its summary and its resource table — so the diagnostic ends up about
# a hundred lines above the end of a log that is otherwise all progress.
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
# A hundred lines of spinner sit between the diagnostic and the end of that
# log. If the report only tails, the answer is not in it — and the whole point
# of the probe is that the answer comes back without a second fetch.
expect_within "the diagnostic is at the top of the report, not a tail away" 25 \
  "fatal error: 'ash/constants/ash_switches.h' file not found" "$out"
# And the tail comes too. This script's header has always said the windows go
# first and the tail follows "for context rather than instead of them"; the
# gate that withheld it from every real run contradicted that, so the rule is
# asserted here rather than left to the comment.
contains "and the tail follows it for context" "-- the last of" "$out"

# ---- a link failure, which has no `stderr:` block at all --------------------
#
# A `visibility` refusal and an undefined symbol both arrive as a FAILED: line
# and lld's own words, with no compiler diagnostic anywhere. A report keyed
# only on `error:` would come back empty from the two failures this probe is
# most likely to find.
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
# The shell around the build has swallowed a command's output before in this
# repository — twice, in engine.yml's own history — and a report that prints
# nothing when it recognises nothing is indistinguishable from a build that
# passed. It has to say so in its own words and show the log's last lines.
#
# THIS FIXTURE IS THE ONE SHAPE WITH NO `drm probe:` LINE IN IT, and that is
# the whole of what it stands for: engine-drm-probe.sh prints `configuring
# out/DrmProbe` before anything can go wrong, so a log without that line is a
# log whose script never ran. It is NOT the shape of a probe that ran and
# failed — see the next case, which is, and which this fixture was once
# mistaken for.
QUIET="$WORK/quiet.log"
{ echo "entering environment"; noise 30; } >"$QUIET"
out="$("$REPORT" "$QUIET" 2>&1)"
contains "a log with no probe output says the script never ran" \
  "nothing in the log looks like a failure" "$out"
contains "and shows the last thing that was said" "filler_30.o" "$out"

# ---- a probe that ran, failed, and used none of the markers -----------------
#
# THE CASE THE `[ -z "$verdict" ]` GATE MADE UNREACHABLE. Every branch of
# engine-drm-probe.sh that can fail has already printed `drm probe:
# configuring out/DrmProbe` by the time it does, so on any run that started at
# all the verdict is non-empty — and the tail that is supposed to catch a
# failure none of the markers recognise sat behind exactly that test. The
# result was a report that brought back neither the error nor a tail nor an
# alarm, which is the one thing its own header says it exists to prevent.
#
# A python action that died is the realistic shape: `gcc_solink_wrapper.py`
# raising MemoryError writes no `FAILED:`, no `ERROR at `, no `stderr:` and
# not even an `error:` — `MemoryError` carries no colon. The probe still says
# it could not build, but what it could not say is why.
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
contains "an unrecognised failure comes back in the tail" "MemoryError" "$out"
contains "with the action that raised it" "gcc_solink_wrapper.py" "$out"
contains "and the probe's own account of how far it got" \
  "drm probe: building ui/ozone" "$out"
# The probe ran and said so. Telling a reader the shell never ran the build
# would send them to the wrong machine — that alarm belongs to the case above
# and to nothing else.
lacks "and it does not blame the shell for a probe that plainly ran" \
  "so the shell around it did not run the build" "$out"

# A log that does not exist is not the same as one with nothing in it: the
# first means the step before never ran, and guessing between them is how a
# run reports on the previous run's file.
out="$("$REPORT" "$WORK/absent.log" 2>&1)"
contains "a missing log is named as missing" "$WORK/absent.log" "$out"

# ---- bounded ---------------------------------------------------------------
#
# A real probe log is hundreds of thousands of lines. A report that prints the
# whole thing is the same failure as one that prints none of it: the answer is
# in there and nobody will find it.
BIG="$WORK/big.log"
{ noise 20000; echo "ninja: build stopped: subcommand failed."; } >"$BIG"
lines="$("$REPORT" "$BIG" 2>&1 | wc -l)"
if [ "$lines" -le 200 ]; then
  printf '  ok    %s\n' "a 20000-line log is reported in $lines lines"
else
  printf '  FAIL  %s\n' "a 20000-line log produced $lines lines of report"
  FAILED=$((FAILED + 1))
fi

# ---- a clean log ------------------------------------------------------------
#
# The probe's own verdict line, which is the answer when it works. The report
# runs on success too — a green run that says nothing about what it configured
# is a green run nobody can cite.
OK="$WORK/ok.log"
{ noise 50; echo "siso: build finished"; echo "drm probe: ui/ozone built"; } >"$OK"
out="$("$REPORT" "$OK" 2>&1)"
contains "a clean log reports the verdict line" "drm probe: ui/ozone built" "$out"
lacks "and invents no failure" "nothing in the log looks like a failure" "$out"
# The other direction of the fix above: a tail printed under a success reads
# as one, so widening the tail must not widen it onto a green run.
lacks "and a run that got there needs no tail" "-- the last of" "$out"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
