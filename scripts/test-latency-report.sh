#!/usr/bin/env bash
# What the latency guard concludes from a compositor log.
#
# The unit is `lib-latency.sh`. It exists because the alternative is a guard
# whose reading of its own measurement can only be exercised by building
# Chromium, starting a browser and waiting four minutes — which means it is
# never exercised, and a threshold that silently stopped comparing would go on
# passing for as long as nobody looked.
#
# The fixtures are the lines the compositor really writes: `Spread::line` in
# `packages/domicile-compositor/src/latency.rs` builds them and its own unit
# tests assert them whole, so a rewording at that end fails there and a
# misreading at this end fails here.
#
# The comparison is the part worth having. `[ 16.68 -le 33.34 ]` is not a
# failed comparison, it is a syntax error, and the shape that quietly is not
# one — `${x%.*}` — discards the decimals the whole check is about.
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

# A whole run, in the shape the compositor writes it: tracing's prefix, the
# target, then the message. The prefix is included so a grep anchored on the
# start of a line fails here rather than on the runner.
COMPLETE="$(cat <<'RUN'
2026-09-07T14:00:00.1Z  INFO domicile::engine::spike: latency: the display frame is 16.67 ms
2026-09-07T14:00:00.2Z  INFO domicile::engine::spike: latency floor: min 16.60, median 16.67, max 17.90 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.3Z  INFO domicile::engine::spike: latency key to commit: min 0.90, median 1.40, max 9.10 ms over 60 (median 0.1 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.5Z  INFO domicile::engine::spike: latency key to pixel: min 17.51, median 18.08, max 43.20 ms over 60 (median 1.1 frames)
2026-09-07T14:00:00.6Z  INFO domicile::engine::spike: latency: 0 round(s) abandoned by the client
2026-09-07T14:00:00.65Z  INFO domicile::engine::spike: latency: 2 round(s) where the client drew again while polling
2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run completed
RUN
)"

RUN_LOG="$(log_of "$COMPLETE")"

expect "the floor's median comes off its own line" \
  "16.67" "$(latency_median floor "$RUN_LOG")"

# The one the design is answerable for, and the one a wrong anchor would take
# from the wrong line: every line here has a `median`.
expect "commit to pixel's median is not the floor's" \
  "16.68" "$(latency_median "commit to pixel" "$RUN_LOG")"

expect "a two-word label reads as one label" \
  "1.40" "$(latency_median "key to commit" "$RUN_LOG")"

expect "a completed run says so" "completed" "$(latency_ended "$RUN_LOG")"
expect "an unabandoned run says none" "0" "$(latency_abandoned "$RUN_LOG")"

# Its own line and its own reader, and the reason both exist: a round the
# client answered with two frames and one it never answered at all look the
# same from the abandoned count, and they are opposite findings. Anchored on
# its own wording so it cannot read the abandoned line, which also matches
# `latency: <n> round(s)`.
expect "a run the client redrew during says how often" \
  "2" "$(latency_redrew "$RUN_LOG")"
expect "and the abandoned count is not it" \
  "0" "$(latency_abandoned "$RUN_LOG")"

# "Nothing measured" is the compositor's own line for a spread with no samples.
# It must not read as a number, and it must not read as the previous line's.
NOTHING="$(log_of "2026-09-07T14:00:00.2Z  INFO domicile::engine::spike: latency floor: min 16.60, median 16.67, max 17.90 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: nothing measured")"
expect "a spread with no samples yields no number" \
  "" "$(latency_median "commit to pixel" "$NOTHING")"
expect "and does not borrow the line above it" \
  "16.67" "$(latency_median floor "$NOTHING")"

# A run that measured something and then measured nothing has no reading, and
# must not be handed the earlier one. This is what decides whether the reader
# takes the last line for the label or the last line with a number on it.
STALE="$(log_of "2026-09-07T13:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)
2026-09-07T14:00:00.4Z  INFO domicile::engine::spike: latency commit to pixel: nothing measured")"
expect "a later 'nothing measured' is not given the earlier number" \
  "" "$(latency_median "commit to pixel" "$STALE")"

# The two give-up endings blame different halves and must not collapse.
UNSETTLED="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run gave up — the screen at the probe point never held still, so the probe could not be priced against it")"
expect "a screen that never settled is not a dark probe" \
  "unsettled" "$(latency_ended "$UNSETTLED")"

DARK="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run gave up — the probe stopped answering")"
expect "a dark probe is not a screen that never settled" \
  "dark" "$(latency_ended "$DARK")"

EMPTY="$(log_of "2026-09-07T14:00:00.7Z  INFO domicile_compositor: chrome client connected")"
expect "a log with no run in it says nothing rather than completed" \
  "" "$(latency_ended "$EMPTY")"
expect "and has no abandoned count to report" \
  "" "$(latency_abandoned "$EMPTY")"

# A control's run, where the client answers no keys.
CONTROL="$(log_of "2026-09-07T14:00:00.6Z  INFO domicile::engine::spike: latency: 3 round(s) abandoned by the client
2026-09-07T14:00:00.7Z  INFO domicile::engine::spike: latency: the run completed")"
expect "a client that answered nothing is counted" \
  "3" "$(latency_abandoned "$CONTROL")"

# The compositor's log is colourised: tracing wraps the timestamp, the level
# and the target in escapes. The message after them is plain, which is what
# these greps rely on — so one fixture carries the real escapes rather than
# every fixture carrying none.
ANSI="$(log_of "$(printf '\033[2m2026-09-07T14:00:00.4Z\033[0m \033[32m INFO\033[0m \033[2mdomicile::engine::spike\033[0m\033[2m:\033[0m latency commit to pixel: min 16.61, median 16.68, max 34.10 ms over 60 (median 1.0 frames)')")"
expect "a colourised line reads the same as a plain one" \
  "16.68" "$(latency_median "commit to pixel" "$ANSI")"

# The threshold. Two decimals, and the numbers that matter are within a few
# hundredths of each other.
latency_within 16.68 2 16.67 && expect "one floor is within two floors" ok ok ||
  expect "one floor is within two floors" ok FAILED
latency_within 33.35 2 16.67 && expect "just over two floors is not" ok FAILED ||
  expect "just over two floors is not" ok ok
latency_within 33.33 2 16.67 && expect "just under two floors is" ok ok ||
  expect "just under two floors is" ok FAILED

# The case that decides whether this is a comparison at all: integer truncation
# would make both of these 16 and 16, and pass.
latency_within 16.99 1 16.01 && expect "a difference in the decimals is seen" ok FAILED ||
  expect "a difference in the decimals is seen" ok ok

# A threshold that passes when it could not read the numbers is worse than none.
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
