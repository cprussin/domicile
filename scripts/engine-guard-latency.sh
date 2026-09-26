#!/usr/bin/env bash
# What a keystroke costs to reach a pixel.
#
# The one requirement nothing measured for a long time, and the longest of the
# guards: sixty rounds, each a keystroke and a wait for the browser to draw.
# Which is why it is last in the group — everything cheaper has already had its
# say by the time this starts.
#
# Its control is a client that ignores the keyboard. Without it the guard would
# pass on any client that merely draws, and the number it reported would be a
# number about something else. Short, because what it proves needs three rounds
# rather than sixty.
#
# THE ONE CHECK HERE THAT TAKES THE RENDER NODE, and the only one that needs
# to. `crux` runs two jobs at once now — `crux` holds the 97G checkout and
# `crux-light` takes the every-pull-request guard, which was measured at 1m51s
# of work behind 3h01m of queue while there was one slot. That second slot gave
# away the thing the single slot was providing by accident: one client on the
# card. Every other check in this group survives losing it, because a pixel
# comparison asks whether a color landed and a busy machine makes that slower
# rather than wrong.
#
# WHICH HOLDS ONLY WHILE EACH OF THEM IS PATIENT ENOUGH TO BE SLOWED, and one
# of them was not. Once the tree pool made an engine run about eleven minutes
# of mostly guards rather than four hours of mostly compiling, the two jobs
# overlapped where they used to miss each other, and `guard-client-window.sh`
# gave up after 60s: `pinned-engine.yml` went red on `main` beside a green run
# of this job. Its poll waits four minutes now and
# `scripts/test-the-client-window-guard-outwaits-a-busy-card.sh` is what keeps
# it there — patience rather than this lock, because that guard is slow beside
# another client and not wrong.
#
# THIS ONE IS THE KIND THAT IS WRONG. It reports a duration, and another job
# drawing on the same node during those sixty rounds is indistinguishable from
# the regression it exists to catch — a red check nobody caused, which is the
# failure mode that teaches people to re-run until green.
#
# HELD ACROSS THE CONTROL AS WELL AS THE MEASUREMENT, because the control is a
# second run of the same script and a number taken beside somebody else's client
# is not a control for one that was not.
#
# AND TAKEN HERE RATHER THAN AROUND THE GROUP. `engine.yml` used to hold it for
# these two steps and no others; the group is one step now, and holding the card
# for every check in it would be most of ten minutes of guards that do not need
# it — which is the one-queue arrangement the second slot exists to leave. So
# the lock moved to the check that wants it, which is where it belonged.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# THE DROP IS A TRAP, which is this check's version of `if: ${{ always() }}`.
# A lock left behind by a run that died is the ordinary way this one leaks, and
# it is now a step that cannot be reached separately — so the drop has to be
# attached to the shell rather than to a later step. `drop` is a no-op unless
# the lock is still ours, so a run that failed to take it in the first place
# unwinds through here harmlessly, which is the rule the tree lock learned the
# same way.
CARD="$ROOT/.github/scripts/engine-render-node-lock.sh"

# Who holds it, in words a person reading a held-lock message can act on.
# `engine.yml` sets this; a person running the check by hand gets something that
# still names them rather than "someone who did not write their name in it".
CARD_OWNER="${CARD_OWNER:-engine-guard-latency.sh on $(hostname) pid $$}"

# `quiet`, NOT `take`: THE CARD ALONE WAS NOT ENOUGH. Main run 36226737213 held
# it and read a floor of 44.61 ms and 49.04 ms commit to pixel, PR #598's run
# 38.80 ms, each while another run compiled Chromium on the other runner; quiet
# runs read 19-29 ms. So this waits until nothing compiles and no other run's
# guards run (they say so with `noisy`), and a machine never quiet is exit 77:
# it did not run, which STRICT fails, rather than a number about the machine.
"$CARD" quiet "$CARD_OWNER"
trap '"$CARD" drop "$CARD_OWNER"' EXIT

engine_guard_and_control_under_wayland guard-latency.sh
