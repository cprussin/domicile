#!/usr/bin/env bash
# What a guard says when it stops, as a whole sentence.
#
# The unit is `lib-annotate.sh`, which is how a spike guard reports where it
# gave up. That report is the behaviour: it becomes a GitHub annotation, and
# the annotation is the only account of a failed run anyone can reach — the job
# log is a thousand lines of Chromium's startup noise with a byte budget on
# top. So the whole `::error::` line is compared, not a substring.
#
# It exists because a bulk rewrite turned ten multi-argument calls into
# `annotate "$1"`, which dropped every word after the first, and the guards
# went on reporting truncated half-sentences that read as complete ones. A
# `printf` in and a string out needs no display, no Chromium and no runner.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

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

file_of() {
  local f; f="$(mktemp)"
  printf '%s' "$1" >"$f"
  echo "$f"
}

expect "a one-word failure" \
  "::error::it broke" \
  "$(annotate "it broke")"

# The one that was wrong. Every guard writes its longer messages as several
# quoted words across continued lines, the way the shell joins them.
expect "a failure written across several words" \
  "::error::the compositor never settled after 90s, so the boxes were moving" \
  "$(annotate "the compositor never settled" "after 90s," \
              "so the boxes were moving")"

# A percent in a path would otherwise be read by GitHub as the start of an
# escape and eat the characters after it.
expect "a percent sign in the message" \
  "::error::100%25 of a 50%25 page" \
  "$(annotate "100% of a 50% page")"

expect "nothing to say" "::error::" "$(annotate "")"

# The body is the end of a log, newest first: GitHub truncates a long
# annotation from the end, and the end of a build log is where the error is.
LOG="$(file_of 'first
middle
ERROR: the last word')"
expect "a failure that carries its log" \
  "::error::it broke%0A%0AERROR: the last word%0Amiddle%0Afirst" \
  "$(annotate_from "it broke" "$LOG")"

expect "a failure whose log is empty" \
  "::error::it broke" \
  "$(annotate_from "it broke" "$(file_of '')")"

expect "a failure whose log is not there" \
  "::error::it broke" \
  "$(annotate_from "it broke" /nonexistent/log)"

# A skip is not a failure, and the repo parses `SKIP:` for the reason — but CI
# runs these under `set -e`, where exiting 77 is a step failure, so it says it
# both ways.
expect "a guard that could not run" \
  "SKIP: no kitty
::error::no kitty" \
  "$(skip "no kitty")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
