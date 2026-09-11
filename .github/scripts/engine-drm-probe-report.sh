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
# each shape -- a gn assertion, a compiler error, a link error, a failure that
# uses none of those markers, a log with nothing of the probe's in it, and a
# clean one.
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

# What the probe said about itself, which is the whole answer on the run where
# it works. Its own prefix rather than a guess at siso's wording: the script
# that writes it is the one thing here whose output this owns.
said="$(grep -a '^drm probe:' "$LOG" | sed 's/^/  /')"
[ -z "$said" ] || printf '%s\n' "$said"

# THE PROBE SAYING SOMETHING IS NOT THE PROBE SAYING WHY, and one `[ -z
# "$verdict" ]` used to gate both of the branches below as though it were.
# engine-drm-probe.sh prints `configuring out/DrmProbe` before anything can go
# wrong, so on every run that started at all that test was false and neither
# branch could be reached by anything. A probe killed in a python action --
# `gcc_solink_wrapper.py` raising MemoryError, which writes no `FAILED:`, no
# `stderr:` and not even an `error:` -- printed `autoninja could not build
# ui/ozone` and brought back no tail, no alarm, and not one word of the
# traceback. They are two questions and they are asked separately now.

# Did the script run at all? Nothing of its own in the log AND nothing shaped
# like a failure means the shell around it swallowed the build -- which has
# happened twice in engine.yml's short life, and which looks exactly like a
# pass. This is the only shape that warrants blaming the shell, because a probe
# that reached any of its own branches has already printed a line above.
if [ -z "$said" ] && [ -z "$found" ]; then
  echo "::error::nothing in the log looks like a failure and the probe said nothing of its own, so the shell around it did not run the build"
fi

# Did it build? That, and nothing else, is what withholds the tail -- a tail
# printed under a success reads as a failure, and that is the only harm a tail
# can do. It is deliberately NOT gated on `found` as well: the fallback matches
# a bare `ninja: build stopped`, which says a build stopped and not one word
# about why, and gating on it would withhold the tail from exactly the failure
# that has nothing else to offer. This is what this script's own header always
# said -- the windows first, and the tail after them FOR CONTEXT RATHER THAN
# INSTEAD OF THEM.
if ! grep -qa '^drm probe: ui/ozone built' "$LOG"; then
  echo "-- the last of $(wc -l <"$LOG" | tr -d ' ') lines:"
  tail -30 "$LOG" | sed 's/^/  | /'
fi
