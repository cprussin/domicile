#!/usr/bin/env bash
# Tests the verdict block of `guard-latency.sh` against fixture logs.
#
# Runs the block from the real script with the real `lib-annotate.sh` and
# `lib-latency.sh`, so moving or rewriting it fails here. Each branch is
# otherwise reachable only by building Chromium and running a browser.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-latency.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-latency.sh
. "$ROOT/packages/domicile-engine/scripts/lib-latency.sh"

# From the line that reads the ending to the end of the file. Empty if that
# line moves, which fails below.
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

# Log lines in the format `Spread::line` writes.
say() { printf '2026-09-07T14:00:00.0Z  INFO domicile::engine::spike: %s\n' "$1"; }
spread() { # $1 label, $2 median
  say "latency $1: min $2, median $2, max $2 ms over 60 (median 1.0 frames)"
}

run_log() { # $1 floor, $2 commit-to-pixel ("" for none), $3 abandoned, $4 ending, $5 undelivered, $6 display frame, $7 moved before the answer, $8 answered too late, $9 commits passed over for coming too soon
  local f; f="$(mktemp "$FIXTURES/XXXXXX")"
  {
    # The guard divides by this. Defaults to 60Hz, which `crux` advertises.
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
    say "latency: ${7:-0} round(s) whose pixel moved before the client answered"
    say "latency: ${8:-0} round(s) whose commit came too late to be the key's answer"
    say "latency: ${9:-0} commit(s) passed over for coming too soon to be the key's answer"
    say "latency: ${5:-0} round(s) whose key was never delivered"
    case "$4" in
      completed) say "latency: the run completed" ;;
      unsettled) say "latency: the run gave up — the screen at the probe point never held still, so the probe could not be priced against it" ;;
      dark) say "latency: the run gave up — the probe stopped answering" ;;
    esac
  } >"$f"
  echo "$f"
}

# Runs the real block in a subshell so its `exit` does not end this test.
verdict() { # $1 log, $2 NEGATIVE
  (
    COMP_LOG="$1"
    NEGATIVE="$2"
    MOST_FRAMES=2
    eval "$VERDICT"
  ) 2>/dev/null | grep -E '^(::error::|PASS:)' | head -1
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

# A frame over the threshold suggests an extra stage, such as a readback, an
# extra composite or a queued frame.
SLOW="$(run_log 16.67 50.10 0 completed)"
expect "a frame that takes three display frames fails" "1" "$(verdict_code "$SLOW" 0)"
expect "and names the frame it is measured against" \
  "::error::guard-latency: commit to pixel is 50.10ms against a display frame of 16.67ms, more than 2x — a client's frame is waiting on a stage of its own somewhere between the commit and the page" \
  "$(verdict "$SLOW" 0)"

# Boundary cases, since this is a float comparison in shell.
expect "just under twice the display frame passes" \
  "0" "$(verdict_code "$(run_log 16.67 33.33 0 completed)" 0)"
expect "just over twice the display frame fails" \
  "1" "$(verdict_code "$(run_log 16.67 33.35 0 completed)" 0)"

# Readings from real CI runs. `commit to pixel` was 28-29 ms each time, but
# the floor varied from 16.43 to 48.71 ms on the same machine. Measured against
# the display frame, both runs give the same verdict.
expect "a run whose floor sampled one frame passes" \
  "0" "$(verdict_code "$(run_log 16.43 27.99 0 completed)" 0)"
expect "and the same reading against a floor that sampled three still passes" \
  "0" "$(verdict_code "$(run_log 48.71 29.18 0 completed)" 0)"

# A high floor must not raise the bar: 50.10 ms is three display frames and
# fails regardless of the floor.
expect "a floor that sampled three frames does not excuse a slow one" \
  "1" "$(verdict_code "$(run_log 48.71 50.10 0 completed)" 0)"
# A low floor must not fail a normal reading.
expect "nor does a floor that sampled low condemn a good one" \
  "0" "$(verdict_code "$(run_log 13.50 28.18 0 completed)" 0)"

# The display frame is the interval the compositor advertises. The floor
# measures the same interval, so a floor far below it means the advertised
# rate is wrong. Contention only raises the floor, so this check fires in one
# direction only.
expect "a display frame nowhere near the floor is not a bar at all" \
  "1" "$(verdict_code "$(run_log 4.20 28.18 0 completed 0 16.67)" 0)"
expect "and says which two numbers disagree" \
  "::error::guard-latency: the run reports a display frame of 16.67ms and priced its probe at 4.20ms — a probe round trip is one display frame, so the frame this would be measured against is not the one this desktop is drawing at" \
  "$(verdict "$(run_log 4.20 28.18 0 completed 0 16.67)" 0)"

# An unanswered round means the client did not respond to the key, so the
# measurement is not key-to-pixel latency.
ABANDONED="$(run_log 16.67 16.68 4 completed)"
expect "an unanswered round fails even with a good number" \
  "1" "$(verdict_code "$ABANDONED" 0)"
expect "and blames the client not changing color" \
  "::error::guard-latency: 4 round(s) went unanswered — the client did not change color when a key was pressed, so what was measured is not a keystroke reaching a pixel" \
  "$(verdict "$ABANDONED" 0)"

# The two give-up endings have different causes.
expect "a screen that never settled points at a redrawing client" \
  "::error::guard-latency: the screen at the probe point never held still, so the probe could not be priced. A client redrawing on its own — a blinking cursor — does this; see cursor_blink_interval in this script" \
  "$(verdict "$(run_log '' '' 0 unsettled)" 0)"
expect "a dark probe points at the page or the browser" \
  "::error::guard-latency: the probe stopped answering, so nothing could be read. Either the page never embedded or the browser is not compositing" \
  "$(verdict "$(run_log '' '' 0 dark)" 0)"

# Assert the message, not just the exit code. `latency_within` also fails on
# an unreadable operand, so a code-only check would pass even if this branch
# were deleted.
expect "a completed run with no floor is not a measurement" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log '' 16.68 0 completed)" 0)"
expect "nor one with no commit-to-pixel" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log 16.67 '' 0 completed)" 0)"
# A missing display frame gets its own message, not a comparison against an
# empty string.
expect "nor one that never reported a display frame" \
  "::error::guard-latency: the run completed without all of a floor, a display frame and a commit-to-pixel figure, so there is nothing to compare" \
  "$(verdict "$(run_log 16.67 16.68 0 completed 0 '')" 0)"

# A single unanswered round must fail. The fixture above uses four, which a
# `-gt 3` check would pass.
expect "even a single unanswered round fails" \
  "1" "$(verdict_code "$(run_log 16.67 16.68 1 completed)" 0)"

# An undelivered key is the compositor's failure, and it shrinks the sample
# the median covers.
expect "an undelivered key fails, and is not the client's fault" \
  "::error::guard-latency: 2 round(s) never had their key delivered, so the run measured fewer rounds than it set out to and the compositor is what failed, not the client" \
  "$(verdict "$(run_log 16.67 16.68 0 completed 2)" 0)"

# The client's answer cannot reach the screen before the commit the round
# waits for. So a probe point that changed earlier was changed by an older
# frame, and the round is dropped.
MOVED="$(run_log 16.67 16.68 0 completed 0 16.67 2)"
expect "a round whose pixel moved before the client answered fails" \
  "1" "$(verdict_code "$MOVED" 0)"
expect "and says the keystroke is not what moved it" \
  "::error::guard-latency: 2 round(s) had the probe point change color before the client answered, so a frame from before the keystroke is what changed it and the run measured fewer rounds than it set out to" \
  "$(verdict "$MOVED" 0)"

# A commit long after the key (55 display frames in the observed case) is a
# client redraw, not the key's answer. The round is dropped.
LATE="$(run_log 16.67 16.68 0 completed 0 16.67 0 2)"
expect "a round whose commit came too late fails" \
  "1" "$(verdict_code "$LATE" 0)"
expect "and says the wait is what is wrong with it" \
  "::error::guard-latency: 2 round(s) had the client commit too long after the key for the key to have caused it, so what would have been timed is a redraw of the client's own and the run measured fewer rounds than it set out to" \
  "$(verdict "$LATE" 0)"

# A commit very soon after the key is a frame already in flight. The round
# skips it and keeps waiting, so the run does not fail.
SOON="$(run_log 16.67 16.68 0 completed 0 16.67 0 0 2)"
expect "a commit passed over for coming too soon does not fail the run" \
  "0" "$(verdict_code "$SOON" 0)"

# A run with no ending. A round advances only on a commit, so a client that
# never redraws after a key leaves the run waiting. A terminal that ignores
# OSC 11 does this, so the message names it.
# The log is empty so the title can be compared whole; `annotate_from`
# appends the log's tail.
NOTHING="$(mktemp "$FIXTURES/XXXXXX")"
expect "a run that never reported fails" "1" "$(verdict_code "$NOTHING" 0)"
expect "and names the client's redraw as a cause" \
  "::error::guard-latency: the run never finished. Either the client never committed a frame after a key — check that it takes OSC 11 for its background — or the compositor stopped before it could report" \
  "$(verdict "$NOTHING" 0)"

# A partial log still fails; the annotation includes its tail.
STARTED_ONLY="$(mktemp "$FIXTURES/XXXXXX")"
say "latency: the display frame is 16.67 ms" >"$STARTED_ONLY"
expect "a run that priced the probe and then stopped also fails" \
  "1" "$(verdict_code "$STARTED_ONLY" 0)"

# --- the negative control ---

CONTROL="$(run_log 16.67 '' 3 completed)"
expect "a client answering no keys is a correct control" \
  "0" "$(verdict_code "$CONTROL" 1)"
expect "and says so" \
  "PASS: negative control: correct, a client that answers no keys is not a measurement" \
  "$(verdict "$CONTROL" 1)"

# If the guard matched something other than the client's keystrokes, the
# control would still produce a figure.
expect "a control that still measured something fails" \
  "1" "$(verdict_code "$(run_log 16.67 16.68 3 completed)" 1)"
expect "and says what that means" \
  "::error::guard-latency negative control: a client that answers no keys still produced a commit-to-pixel figure of 16.68 ms — the run is measuring something other than its own keystrokes" \
  "$(verdict "$(run_log 16.67 16.68 3 completed)" 1)"

# A control must price the probe and then measure nothing. A run that fell
# over proves nothing.
expect "a control whose run never completed fails" \
  "1" "$(verdict_code "$(run_log '' '' 0 dark)" 1)"
expect "a control that never priced the probe fails" \
  "1" "$(verdict_code "$(run_log '' '' 3 completed)" 1)"
expect "a control where nothing was abandoned fails" \
  "1" "$(verdict_code "$(run_log 16.67 '' 0 completed)" 1)"

# The "moved before the answer" check belongs to the measurement, not the
# control. This fails if that check moves above the control's branch.
expect "a control whose rounds moved before an answer is still a correct control" \
  "0" "$(verdict_code "$(run_log 16.67 '' 1 completed 0 16.67 2)" 1)"

# The control asks whether any round was dropped, not how. Where a
# self-redraw lands decides which count a dropped round goes to, so requiring
# a particular count would flake.
expect "a control whose rounds all moved before an answer is still a correct control" \
  "0" "$(verdict_code "$(run_log 16.67 '' 0 completed 0 16.67 2)" 1)"
expect "a control whose rounds all came too late is still a correct control" \
  "0" "$(verdict_code "$(run_log 16.67 '' 0 completed 0 16.67 0 3)" 1)"
# A commit skipped for coming too soon does not drop the round.
expect "a control whose only count is commits passed over for coming too soon fails" \
  "1" "$(verdict_code "$(run_log 16.67 '' 0 completed 0 16.67 0 0 3)" 1)"

# One dropped round is enough. The control checks that the guard notices,
# not how often.
expect "a control with a single abandoned round is enough" \
  "0" "$(verdict_code "$(run_log 16.67 '' 1 completed)" 1)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
