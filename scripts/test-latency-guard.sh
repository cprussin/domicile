#!/usr/bin/env bash
# What the latency guard decides, given a run's log.
#
# The unit is the verdict block at the end of `guard-latency.sh` — everything
# after the run has finished and the numbers are in hand. It is run out of the
# real script rather than copied, through the real `annotate` and the real
# `lib-latency.sh`, so a rewrite that moves it fails here loudly instead of
# leaving this passing against a version nobody ships.
#
# It exists because that block is nine branches deep and every one of them can
# only be reached by building Chromium, starting a browser and waiting several
# minutes. This branch has already shipped a box assertion that compared digits
# out of a colour string and a stability check that measured an idle client; a
# guard that reads its own measurement wrongly is the same class of defect, and
# the negative control is where it would hide, because a control that passes for
# the wrong reason looks exactly like one that works.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-latency.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-latency.sh
. "$ROOT/packages/domicile-engine/scripts/lib-latency.sh"

# From the line that reads the ending to the end of the file. A whole-line
# anchor, so it cannot half-match; empty if it moves, which bails below.
VERDICT="$(sed -n '/^ENDED="\$(latency_ended "\$COMP_LOG")"$/,$p' "$GUARD")"
[ -n "$VERDICT" ] || {
  echo "no verdict block in $GUARD — its first line moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

# The lines the compositor writes, as `Spread::line` builds them and
# `latency.rs`'s own tests assert them.
say() { printf '2026-09-07T14:00:00.0Z  INFO domicile::engine::spike: %s\n' "$1"; }
spread() { # $1 label, $2 median
  say "latency $1: min $2, median $2, max $2 ms over 60 (median 1.0 frames)"
}

run_log() { # $1 floor, $2 commit-to-pixel ("" for none), $3 abandoned, $4 ending, $5 undelivered, $6 display frame
  local f; f="$(mktemp "$FIXTURES/XXXXXX")"
  {
    # The compositor says this first, and the guard divides by it. Defaulted to
    # 60Hz, which is what `crux` advertises, so that a fixture only says
    # otherwise when the frame is what it is about.
    [ -n "${6-16.67}" ] && say "latency: the display frame is ${6-16.67} ms"
    [ -n "$1" ] && spread floor "$1"
    say "latency key to commit: min 1.40, median 1.40, max 1.40 ms over 60 (median 0.1 frames)"
    if [ -n "$2" ]; then
      spread "commit to pixel" "$2"
      spread "key to pixel" "$2"
    else
      say "latency commit to pixel: nothing measured"
      say "latency key to pixel: nothing measured"
    fi
    say "latency: $3 round(s) abandoned by the client"
    say "latency: ${5:-0} round(s) whose key was never delivered"
    case "$4" in
      completed) say "latency: the run completed" ;;
      unsettled) say "latency: the run gave up — the screen at the probe point never held still, so the probe could not be priced against it" ;;
      dark) say "latency: the run gave up — the probe stopped answering" ;;
    esac
  } >"$f"
  echo "$f"
}

# Runs the real block. The subshell keeps its `exit` from ending this test, and
# the annotation is what the block actually says.
verdict() { # $1 log, $2 NEGATIVE
  (
    COMP_LOG="$1"
    NEGATIVE="$2"
    MOST_FRAMES=2
    eval "$VERDICT"
  ) 2>/dev/null | grep -E '^(::error::|PASS:|negative control: correct)' | head -1
}
verdict_code() { # $1 log, $2 NEGATIVE
  (
    COMP_LOG="$1"
    NEGATIVE="$2"
    MOST_FRAMES=2
    eval "$VERDICT"
  ) >/dev/null 2>&1
  echo $?
}

# --- the measurement itself ---

GOOD="$(run_log 16.67 16.68 0 completed)"
expect "a frame that arrives in one display frame passes" \
  "0" "$(verdict_code "$GOOD" 0)"
expect "and says what it was measured against" \
  "PASS: a client's frame reaches the page in 16.68ms, within 2 display frames of 16.67ms." \
  "$(verdict "$GOOD" 0)"

# The whole point of the threshold: a stage of its own is what a readback, an
# extra composite or a frame held for a queue would look like.
SLOW="$(run_log 16.67 50.10 0 completed)"
expect "a frame that takes three display frames fails" "1" "$(verdict_code "$SLOW" 0)"
expect "and names the frame it is measured against" \
  "::error::guard-latency: commit to pixel is 50.10ms against a display frame of 16.67ms, more than 2x — a client's frame is waiting on a stage of its own somewhere between the commit and the page" \
  "$(verdict "$SLOW" 0)"

# Just inside and just outside, because this is a float comparison in a shell.
expect "just under twice the display frame passes" \
  "0" "$(verdict_code "$(run_log 16.67 33.33 0 completed)" 0)"
expect "just over twice the display frame fails" \
  "1" "$(verdict_code "$(run_log 16.67 33.35 0 completed)" 0)"

# THE PAIR THIS DENOMINATOR EXISTS FOR, and both are readings off real CI runs
# rather than shapes somebody imagined. `commit to pixel` came back at 28-29 ms
# on all four runs there have been; the floor came back at 16.43 on one and
# 48.71 on another, of the same probe on the same machine. Against the display
# frame the verdict is the same both times. Against the floor it was 1.70 and
# 0.60 — the same reading, three quarters of the way to failing on one run and
# comfortable on the next.
expect "a run whose floor sampled one frame passes" \
  "0" "$(verdict_code "$(run_log 16.43 27.99 0 completed)" 0)"
expect "and the same reading against a floor that sampled three still passes" \
  "0" "$(verdict_code "$(run_log 48.71 29.18 0 completed)" 0)"

# The other end of it, and the one that matters more: a floor sampled high used
# to RAISE the bar, so a run that had genuinely grown a stage would have been
# let through by the same noise. 50.10ms is three display frames and fails
# whatever the floor did.
expect "a floor that sampled three frames does not excuse a slow one" \
  "1" "$(verdict_code "$(run_log 48.71 50.10 0 completed)" 0)"
# And a floor sampled below one frame does not manufacture a failure out of a
# reading every other run called a pass.
expect "nor does a floor that sampled low condemn a good one" \
  "0" "$(verdict_code "$(run_log 13.50 28.18 0 completed)" 0)"

# THE FLOOR STILL HAS A JOB, and this is it: the display frame is what this
# desktop *advertises* — `display_interval` in the compositor says so — and
# nothing else here can ask viz what it really is. The floor is the same
# quantity measured, so a frame far larger than the floor means the number the
# bar is built from is not the number the display is running at. It can only
# fire in that direction: contention pushes the floor up, never below the frame.
expect "a display frame nowhere near the floor is not a bar at all" \
  "1" "$(verdict_code "$(run_log 4.20 28.18 0 completed 0 16.67)" 0)"
expect "and says which two numbers disagree" \
  "::error::guard-latency: the run reports a display frame of 16.67ms and priced its probe at 4.20ms — a probe round trip is one display frame, so the frame this would be measured against is not the one this desktop is drawing at" \
  "$(verdict "$(run_log 4.20 28.18 0 completed 0 16.67)" 0)"

# A round nobody answered means the client did not do the thing being timed, so
# whatever was measured is not a keystroke reaching a pixel.
ABANDONED="$(run_log 16.67 16.68 4 completed)"
expect "an unanswered round fails even with a good number" \
  "1" "$(verdict_code "$ABANDONED" 0)"
expect "and blames the client not changing colour" \
  "::error::guard-latency: 4 round(s) went unanswered — the client did not change colour when a key was pressed, so what was measured is not a keystroke reaching a pixel" \
  "$(verdict "$ABANDONED" 0)"

# The two give-up endings point at different things and must say so.
expect "a screen that never settled points at a redrawing client" \
  "::error::guard-latency: the screen at the probe point never held still, so the probe could not be priced. A client redrawing on its own — a blinking cursor — does this; see cursor_blink_interval in this script" \
  "$(verdict "$(run_log '' '' 0 unsettled)" 0)"
expect "a dark probe points at the page or the browser" \
  "::error::guard-latency: the probe stopped answering, so nothing could be read. Either the page never embedded or the browser is not compositing" \
  "$(verdict "$(run_log '' '' 0 dark)" 0)"

# A completed run with no numbers in it is not a pass. The message is asserted
# and not only the exit code: `latency_within` refuses an unreadable operand
# too, so a code-only check passes through that instead of through the branch
# it names — and the branch could be deleted outright with these still green.
expect "a completed run with no floor is not a measurement" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log '' 16.68 0 completed)" 0)"
expect "nor one with no commit-to-pixel" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log 16.67 '' 0 completed)" 0)"
# And a run that never said what a display frame is has no denominator at all,
# which must be its own answer rather than a comparison against an empty string.
expect "nor one that never reported a display frame" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log 16.67 16.68 0 completed 0 '')" 0)"

# One unanswered round out of sixty is the signal this guard exists for, and
# the only abandoned fixture above uses four — which a `-gt 3` would let past.
expect "even a single unanswered round fails" \
  "1" "$(verdict_code "$(run_log 16.67 16.68 1 completed)" 0)"

# A round whose key we never delivered is our failure, not the client's, and it
# means the median is over a smaller run than the one reported.
expect "an undelivered key fails, and is not the client's fault" \
  "::error::guard-latency: 2 round(s) never had their key delivered, so the run measured fewer rounds than it set out to and the compositor is what failed, not the client" \
  "$(verdict "$(run_log 16.67 16.68 0 completed 2)" 0)"

# A run that never reported at all. Distinct from every case above, which all
# have an ending: a round only advances on a commit, so a client that answers a
# key with no redraw leaves the run waiting rather than abandoning rounds. A
# terminal that does not take OSC 11 for its background lands here, and the
# message has to name that rather than blaming the seam.
# Empty, so the title stands alone and can be compared whole: `annotate_from`
# appends the log's tail, which is the right behaviour and not what is being
# asserted here.
NOTHING="$(mktemp "$FIXTURES/XXXXXX")"
expect "a run that never reported fails" "1" "$(verdict_code "$NOTHING" 0)"
expect "and names the client's redraw as a cause" \
  "::error::guard-latency: the run never finished. Either the client never committed a frame after a key — check that it takes OSC 11 for its background — or the compositor stopped before it could report" \
  "$(verdict "$NOTHING" 0)"

# And with a log behind it, which is the real case: still a failure, and the
# log's tail comes with the annotation.
STARTED_ONLY="$(mktemp "$FIXTURES/XXXXXX")"
say "latency: the display frame is 16.67 ms" >"$STARTED_ONLY"
expect "a run that priced the probe and then stopped also fails" \
  "1" "$(verdict_code "$STARTED_ONLY" 0)"

# --- the negative control, which is where a wrong answer hides ---

CONTROL="$(run_log 16.67 '' 3 completed)"
expect "a client answering no keys is a correct control" \
  "0" "$(verdict_code "$CONTROL" 1)"
expect "and says so" \
  "negative control: correct, a client that answers no keys is not a measurement" \
  "$(verdict "$CONTROL" 1)"

# THE CASE THE CONTROL EXISTS FOR. If the guard were matching something other
# than the client's own keystrokes, the control would still produce a figure.
expect "a control that still measured something fails" \
  "1" "$(verdict_code "$(run_log 16.67 16.68 3 completed)" 1)"
expect "and says what that means" \
  "::error::guard-latency negative control: a client that answers no keys still produced a commit-to-pixel figure of 16.68 ms — the run is measuring something other than its own keystrokes" \
  "$(verdict "$(run_log 16.67 16.68 3 completed)" 1)"

# A control that passes because the run fell over proves nothing about the
# guard: it has to get as far as pricing the probe and then find nothing.
expect "a control whose run never completed fails" \
  "1" "$(verdict_code "$(run_log '' '' 0 dark)" 1)"
expect "a control that never priced the probe fails" \
  "1" "$(verdict_code "$(run_log '' '' 3 completed)" 1)"
expect "a control where nothing was abandoned fails" \
  "1" "$(verdict_code "$(run_log 16.67 '' 0 completed)" 1)"

# And one is enough. What the control proves is that the guard *notices* a
# client answering nothing, so the check is "at least one", not "how many" —
# without this, tightening it to demand several would go unnoticed and a
# control that worked would start failing.
expect "a control with a single abandoned round is enough" \
  "0" "$(verdict_code "$(run_log 16.67 '' 1 completed)" 1)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
