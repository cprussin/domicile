#!/usr/bin/env bash
# What the DRM probe found, from a log that is mostly progress.
#
#   .github/scripts/engine-drm-probe-report.sh /tmp/domicile-drm-probe.log
#
# THE PROBE IS ONLY WORTH RUNNING IF IT COMES BACK WITH A SENTENCE. It takes
# the single-writer Chromium tree on `crux`, queues behind whatever else holds
# it, and answers one question -- whether a patched tree configures and
# compiles with `ozone_platform_drm = true`. A run that ends `Process completed
# with exit code 1` has spent all of that and brought back nothing.
#
# The answer is never at the end of the log. gn stops on an assert and then
# prints nothing else; siso prints the compiler's own words in a `stderr:`
# block and then carries on with the steps already in flight, its summary and
# its resource table, so the diagnostic lands about a hundred lines above the
# end. `tail -25` was measured catching the spinner and the resource table and
# nothing else -- that is engine.yml's Build step's scar, and this is the same
# lesson written once rather than inlined again.
#
# So: windows around the markers first, at the TOP of the output, and the tail
# after them for context rather than instead of them.
#
# A script rather than an inline `run:` block for the reason
# engine-diagnostics.sh is one: GitHub echoes a step's script into the log
# before running it, so a long one buries the failure under its own source.
#
# scripts/test-engine-drm-probe-report.sh drives this over synthesised logs of
# each shape -- a gn assertion, a compiler error, a link error, a log with
# nothing in it, and a clean one.
set -u

LOG="${1:-}"
[ -n "$LOG" ] || { echo "usage: $(basename "$0") <probe log>" >&2; exit 2; }

# A log that is not there and a log with nothing in it are different failures:
# the first says the step that writes it never ran, and the second says it ran
# and said nothing. Guessing between them is how a run reports on a previous
# run's file.
if [ ! -f "$LOG" ]; then
  echo "::error::no probe log at $LOG, so the step that writes it never ran"
  exit 0
fi

# How much of the log to show around each marker, and how many markers. Twenty
# lines is a `FAILED:` line, the compile command, siso's `stderr:` and the
# whole of a clang diagnostic with its caret art; three markers is the first
# failure plus whatever else was already in flight when it happened. More than
# that is not more information -- a broken header fails every translation unit
# that includes it, and the first one says why.
SPAN=20
MAX=3

echo "== what the probe said =="

# One pass, so that a `stderr:` inside a window opened by its own `FAILED:`
# line is not printed twice. `ERROR at ` is gn's; `FAILED:` is ninja's and
# siso's; `stderr:` is siso's alone, and it is the one that carries the
# compiler's words.
found="$(awk -v span="$SPAN" -v max="$MAX" '
  NR <= until { print "  " $0; next }
  /^FAILED:/ || /^ERROR at / || /^stderr:/ {
    if (blocks >= max) { next }
    blocks++
    print "  " $0
    until = NR + span
  }
' "$LOG")"

# The markers are how siso and gn say it, and a build can still fail in a way
# that uses neither -- a python action that raised, a wrapper that exited
# non-zero with a bare message. Anything shaped like an error is better than
# the tail alone.
if [ -z "$found" ]; then
  found="$(grep -aE 'error:|Error:|ninja: build stopped|gn gen failed' "$LOG" |
    head -20 | sed 's/^/  /')"
fi

[ -z "$found" ] || printf '%s\n' "$found"

# The probe's own verdict, which is the whole answer on the run where it works.
# Its own prefix rather than a guess at siso's wording: the script that writes
# it is the one thing here whose output this owns.
verdict="$(grep -a '^drm probe:' "$LOG" | sed 's/^/  /')"
[ -z "$verdict" ] || printf '%s\n' "$verdict"

# Only when the probe did not reach its own verdict. A run that got there
# needs no tail, and a tail printed under a success reads as one.
if [ -z "$verdict" ]; then
  if [ -z "$found" ]; then
    # THE SHELL AROUND THE BUILD HAS SWALLOWED A COMMAND'S OUTPUT BEFORE, twice
    # in engine.yml's short life. A report that prints nothing when it
    # recognises nothing is indistinguishable from a build that passed, which
    # is the worst thing a report can be.
    echo "::error::nothing in the log looks like a failure and the probe never reached its verdict, so the shell around it did not run the build"
  fi
  echo "-- the last of $(wc -l <"$LOG" | tr -d ' ') lines:"
  tail -30 "$LOG" | sed 's/^/  | /'
fi
