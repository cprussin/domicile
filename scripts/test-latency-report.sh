#!/usr/bin/env bash
# Tests how `lib-latency.sh` reads a compositor log.
#
# Fixtures match the lines `Spread::line` in
# `packages/domicile-compositor/src/latency.rs` writes; its own tests assert
# the format.
#
# The float comparison matters most: `[ 16.68 -le 33.34 ]` is a syntax error,
# and `${x%.*}` drops the decimals the check depends on.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-latency.sh
. "$ROOT/packages/domicile-engine/scripts/lib-latency.sh"

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

log_of() {
  local f; f="$(mktemp "$FIXTURES/XXXXXX")"
  printf '%s\n' "$1" >"$f"
  echo "$f"
}

# A full run, including tracing's prefix, so a grep anchored at line start
# fails here instead of on the runner.
COMPLETE="$(cat <<'RUN'
2026-09-07T14:00:00.1Z  INFO domicile::engine::spike: latency: the display frame is 16.67 ms
2026-09-07T14:00:00.2Z  INFO domicile::engine::spike: latency floor: min 16.60, median 16.67, max 17.90 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.3Z  INFO domicile::engine::spike: latency key to commit: min 0.90, median 1.40, max 9.10 ms over 60 (median 0.1 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.5Z  INFO domicile::engine::spike: latency key to pixel: min 17.51, median 18.08, max 43.20 ms over 60 (median 1.1 frames)
2026-09-07T14:00:00.6Z  INFO domicile::engine::spike: latency: 0 round(s) abandoned by the client
2026-09-07T14:00:00.65Z  INFO domicile::engine::spike: latency: 2 round(s) where the client drew again while polling
2026-09-07T14:00:00.68Z  INFO domicile::engine::spike: latency: 1 round(s) whose pixel moved before the client answered
2026-09-07T14:00:00.69Z  INFO domicile::engine::spike: latency: 3 round(s) whose commit came too late to be the key's answer
2026-09-07T14:00:00.695Z  INFO domicile::engine::spike: latency: 4 commit(s) passed over for coming too soon to be the key's answer
2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run completed
RUN
)"

RUN_LOG="$(log_of "$COMPLETE")"

expect "the floor's median comes off its own line" \
  "16.67" "$(latency_median floor "$RUN_LOG")"

# Every line has a `median`, so a wrong anchor would read the wrong one.
expect "commit to pixel's median is not the floor's" \
  "16.68" "$(latency_median "commit to pixel" "$RUN_LOG")"

expect "a two-word label reads as one label" \
  "1.40" "$(latency_median "key to commit" "$RUN_LOG")"

expect "a completed run says so" "completed" "$(latency_ended "$RUN_LOG")"

# `commit to pixel` is quantized to probe round trips, which last one display
# frame, so the threshold is a multiple of the display frame. The floor is the
# same frame sampled during browser startup and can read three times higher.
expect "the display frame comes off its own line" \
  "16.67" "$(latency_display_frame "$RUN_LOG")"
expect "an unabandoned run says none" "0" "$(latency_abandoned "$RUN_LOG")"

# A redraw during polling and an unanswered round have opposite meanings.
# Anchor on the full wording, since the abandoned line also matches
# `latency: <n> round(s)`.
expect "a run the client redrew during says how often" \
  "2" "$(latency_redrew "$RUN_LOG")"
expect "and the abandoned count is not it" \
  "0" "$(latency_abandoned "$RUN_LOG")"

# A round dropped because the probe point changed before the answer has its
# own line and reader; all these lines match `latency: <n> round(s)`.
expect "a run whose pixel moved before an answer says how often" \
  "1" "$(latency_moved "$RUN_LOG")"
expect "and is neither the abandoned count nor the redrawn one" \
  "0 2" "$(latency_abandoned "$RUN_LOG") $(latency_redrew "$RUN_LOG")"

# A commit too long after the key for the key to have caused it.
expect "a run whose commit came too late says how often" \
  "3" "$(latency_late "$RUN_LOG")"
expect "and is none of the other three" \
  "0 2 1" "$(latency_abandoned "$RUN_LOG") $(latency_redrew "$RUN_LOG") $(latency_moved "$RUN_LOG")"

# A commit very soon after the key is a frame already in flight. Reporting it
# as "too late" would suggest a slow client. Both lines end in the same words,
# so this also checks that each reader anchors on enough to tell them apart.
expect "a run that passed over commits too soon says how many" \
  "4" "$(latency_soon "$RUN_LOG")"
expect "and is not the count of the ones that came too late" \
  "3" "$(latency_late "$RUN_LOG")"

# "Nothing measured" must not read as a number, or as the previous line's.
NOTHING="$(log_of "2026-09-07T14:00:00.2Z  INFO domicile::engine::spike: latency floor: min 16.60, median 16.67, max 17.90 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: nothing measured")"
expect "a spread with no samples yields no number" \
  "" "$(latency_median "commit to pixel" "$NOTHING")"
expect "and does not borrow the line above it" \
  "16.67" "$(latency_median floor "$NOTHING")"

# The reader takes the last line for the label, not the last line with a
# number, so a later "nothing measured" does not inherit an earlier value.
STALE="$(log_of "2026-09-07T13:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: nothing measured")"
expect "a later 'nothing measured' is not given the earlier number" \
  "" "$(latency_median "commit to pixel" "$STALE")"

# The two give-up endings have different causes.
UNSETTLED="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run gave up — the screen at the probe point never held still, so the probe could not be priced against it")"
expect "a screen that never settled is not a dark probe" \
  "unsettled" "$(latency_ended "$UNSETTLED")"

DARK="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run gave up — the probe stopped answering")"
expect "a dark probe is not a screen that never settled" \
  "dark" "$(latency_ended "$DARK")"

EMPTY="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile_compositor: chrome client connected")"
expect "a log with no run in it says nothing rather than completed" \
  "" "$(latency_ended "$EMPTY")"
expect "and no display frame to divide by" \
  "" "$(latency_display_frame "$EMPTY")"
expect "and has no abandoned count to report" \
  "" "$(latency_abandoned "$EMPTY")"
expect "and none of rounds given up before an answer" \
  "" "$(latency_moved "$EMPTY")"
expect "and none of rounds whose commit came too late" \
  "" "$(latency_late "$EMPTY")"
expect "and none of commits passed over too soon" \
  "" "$(latency_soon "$EMPTY")"

# A negative control run, where the client answers no keys.
CONTROL="$(log_of "2026-09-07T14:00:00.6Z  INFO domicile::engine::spike: latency: 3 round(s) abandoned by the client
2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run completed")"
expect "a client that answered nothing is counted" \
  "3" "$(latency_abandoned "$CONTROL")"

# tracing wraps the timestamp, level and target in color escapes. The greps
# rely on the message being plain, so one fixture includes real escapes.
ANSI="$(log_of "$(printf '\033[2m2026-09-07T14:00:00.4Z\033[0m \033[32m INFO\033[0m \033[2mdomicile::engine::spike\033[0m\033[2m:\033[0m latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)')")"
expect "a colorized line reads the same as a plain one" \
  "16.68" "$(latency_median "commit to pixel" "$ANSI")"

FRAME_ANSI="$(log_of "$(printf '\033[2m2026-09-07T14:00:00.1Z\033[0m \033[32m INFO\033[0m \033[2mdomicile::engine::spike\033[0m\033[2m:\033[0m latency: the display frame is 16.67 ms')")"
expect "and so does the display frame" \
  "16.67" "$(latency_display_frame "$FRAME_ANSI")"

# Values that matter differ by hundredths.
latency_within 16.68 2 16.67 && expect "one floor is within two floors" ok ok ||
  expect "one floor is within two floors" ok FAILED
latency_within 33.35 2 16.67 && expect "just over two floors is not" ok FAILED ||
  expect "just over two floors is not" ok ok
latency_within 33.33 2 16.67 && expect "just under two floors is" ok ok ||
  expect "just under two floors is" ok FAILED

# Real CI readings: `commit to pixel` was 28-29 ms, and the floor varied from
# 16.43 to 48.71 ms. Against the display frame both runs pass.
latency_within 27.99 2 16.67 && expect "a run whose floor sampled low still passes" ok ok ||
  expect "a run whose floor sampled low still passes" ok FAILED
latency_within 29.18 2 16.67 && expect "and so does the one whose floor sampled high" ok ok ||
  expect "and so does the one whose floor sampled high" ok FAILED

# Integer truncation would make both 16 and pass.
latency_within 16.99 1 16.01 && expect "a difference in the decimals is seen" ok FAILED ||
  expect "a difference in the decimals is seen" ok ok

# Unreadable numbers must fail.
latency_within "" 2 16.67 && expect "an unread measurement fails" ok FAILED ||
  expect "an unread measurement fails" ok ok
latency_within 16.68 2 "nothing measured" &&
  expect "an unread floor fails" ok FAILED ||
  expect "an unread floor fails" ok ok

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
