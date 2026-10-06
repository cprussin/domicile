#!/usr/bin/env bash
# Summarize a DRM probe log.
#
#   .github/scripts/engine-drm-probe-report.sh /tmp/domicile-drm-probe.log
#
# The probe checks whether a patched tree builds with
# `ozone_platform_drm = true`. Its errors are not at the end of the log: siso
# keeps printing after a failure. So this prints the lines around each error
# marker first, then the tail for context.
#
# A script rather than an inline `run:` block, because GitHub echoes inline
# scripts into the log and a long one hides the failure.
#
# Tested by scripts/test-engine-drm-probe-report.sh.
set -u

LOG="${1:-}"
[ -n "$LOG" ] || { echo "usage: $(basename "$0") <probe log>" >&2; exit 2; }

# A missing log means the probe step never ran, which differs from an empty
# one.
if [ ! -f "$LOG" ]; then
  echo "::error::no probe log at $LOG, so the step that writes it never ran"
  exit 0
fi

# Lines to show after each marker, and the most markers to show. Twenty lines
# fit a failed step with its full clang diagnostic. Later failures usually
# repeat the first.
SPAN=20
MAX=3

echo "== what the probe said =="

# One pass, so a `stderr:` inside a `FAILED:` window is not printed twice.
# `ERROR at ` is gn's, `FAILED:` is ninja's and siso's, and siso's `stderr:`
# holds the compiler output.
found="$(awk -v span="$SPAN" -v max="$MAX" '
  NR <= until { print "  " $0; next }
  /^FAILED:/ || /^ERROR at / || /^stderr:/ {
    if (blocks >= max) { next }
    blocks++
    print "  " $0
    until = NR + span
  }
' "$LOG")"

# Fallback for failures without those markers, such as a python action that
# raised.
if [ -z "$found" ]; then
  found="$(grep -aE 'error:|Error:|ninja: build stopped|gn gen failed' "$LOG" |
    head -20 | sed 's/^/  /')"
fi

[ -z "$found" ] || printf '%s\n' "$found"

# The probe's own status lines.
said="$(grep -a '^drm probe:' "$LOG" | sed 's/^/  /')"
[ -z "$said" ] || printf '%s\n' "$said"

# No probe output and no error means the shell never ran the probe, which
# otherwise looks like a pass.
if [ -z "$said" ] && [ -z "$found" ]; then
  echo "::error::nothing in the log looks like a failure and the probe said nothing of its own, so the shell around it did not run the build"
fi

# Print the tail unless the probe finished. Not gated on `found`, because a
# bare `ninja: build stopped` match explains nothing.
#
# Match the last line the probe prints on success. Update this if the probe
# gains a later stage.
if ! grep -qa '^drm probe: ozone_unittests built' "$LOG"; then
  echo "-- the last of $(wc -l <"$LOG" | tr -d ' ') lines:"
  tail -30 "$LOG" | sed 's/^/  | /'
fi
