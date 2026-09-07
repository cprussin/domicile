#!/usr/bin/env bash
# Reading a latency run out of the compositor's log.
#
# Its own file, sourced by `spike-latency.sh` and by
# `scripts/test-latency-report.sh`, for the reason `lib-annotate.sh` is its own
# file: what a guard concludes from a log is the guard's actual behaviour, and
# behaviour that can only be exercised by starting a browser is behaviour
# nobody exercises. Everything here is a string in and a string out.
#
# The lines these read are built by `Spread::line` in the compositor's
# `latency.rs` and asserted whole by its unit tests, so the two ends of this
# contract are pinned from both sides.

# The median, in milliseconds, off one `latency <what>:` line.
#
# Empty when the line is absent or says "nothing measured", which are different
# facts about a run but the same fact about this: there is no number to compare.
# The caller decides what that means; every caller here treats it as failure.
#
# The LAST line for this label, whatever it says, and then a number out of it —
# rather than the last line that happens to have a number in it. The difference
# shows up on a run that measured something and then measured nothing: anchored
# on `min `, "nothing measured" is invisible and the stale earlier number is
# what comes back, which is a reading presented for a run that had none.
#
# The median is bounded by `, max ` on the way out because the line ends
# `(median 1.0 frames)` and an unbounded `median [0-9.]*` takes that instead.
latency_median() {
  local what="$1" log="$2"
  grep -a "latency $what: " "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*median \([0-9.]*\), max .*/\1/p'
}

# How a run ended, as one word: `completed`, `unsettled`, `dark`, or empty when
# the run never said.
#
# Three outcomes rather than a boolean because they blame different things —
# see `Ended` in `latency.rs` — and a guard that collapsed them would report a
# blinking cursor and a broken probe with the same sentence.
latency_ended() {
  local log="$1"
  if grep -aq "latency: the run completed" "$log" 2>/dev/null; then
    echo completed
  elif grep -aq "latency: the run gave up — the screen" "$log" 2>/dev/null; then
    echo unsettled
  elif grep -aq "latency: the run gave up — the probe" "$log" 2>/dev/null; then
    echo dark
  fi
}

# How many rounds the client left unanswered. Empty when the run never said.
latency_abandoned() {
  local log="$1"
  grep -a "round(s) abandoned by the client" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Whether `$1` is at most `$2` times `$3`, in floating point.
#
# `awk` because these are milliseconds with two decimals and `[` compares
# integers: `[ 16.68 -le 33.34 ]` is not a comparison, it is a syntax error,
# and the shape that silently is not one — `${x%.*}` — throws away exactly the
# precision this is about.
#
# False for an empty or unparseable operand rather than true. A threshold check
# that passes when it could not read the numbers is worse than no check.
latency_within() {
  local got="$1" times="$2" of="$3"
  awk -v got="$got" -v times="$times" -v of="$of" 'BEGIN {
    if (got == "" || of == "" || got + 0 != got || of + 0 != of) { exit 1 }
    exit (got <= times * of) ? 0 : 1
  }'
}
