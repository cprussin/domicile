#!/usr/bin/env bash
# Tests `lib-annotate.sh`, which turns a guard's failure into a GitHub
# annotation.
#
# The annotation is often the only readable account of a failed run, since
# the job log is mostly Chromium startup noise. Each test compares the whole
# `::error::` line, so a truncated message fails.
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

# One directory removed on exit. `file_of` runs inside `$( )`, so it cannot
# record files in a parent-shell array.
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

file_of() {
  # `mktemp`, not a counter: a counter incremented in `$( )` would not persist,
  # so fixtures would share a name.
  local f; f="$(mktemp "$FIXTURES/XXXXXX")"
  printf '%s' "$1" >"$f"
  echo "$f"
}

expect "a one-word failure" \
  "::error::it broke" \
  "$(annotate "it broke")"

# Guards pass long messages as several arguments; all must be kept.
expect "a failure written across several words" \
  "::error::the compositor never settled after 90s, so the boxes were moving" \
  "$(annotate "the compositor never settled" "after 90s," \
              "so the boxes were moving")"

# GitHub reads `%` as an escape, so it must be encoded.
expect "a percent sign in the message" \
  "::error::100%25 of a 50%25 page" \
  "$(annotate "100% of a 50% page")"

expect "nothing to say" "::error::" "$(annotate "")"

# The log is reversed, newest first, because GitHub truncates long
# annotations from the end.
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

# A whitespace-only log counts as empty, so no blank body is added.
expect "a failure whose log is only whitespace" \
  "::error::it broke" \
  "$(annotate_from "it broke" "$(file_of '   ')")"

# A log that ends in a newline, like every real one.
expect "a failure whose log ends in a newline" \
  "::error::it broke%0A%0Alast%0Afirst" \
  "$(annotate_from "it broke" "$(file_of 'first
last
')")"

# turbo and vite print a dozen or so summary lines after the error, so the
# window must reach it. The whole reversed body is compared to check the
# error lands near the front.
BUILD_LOG="$(file_of 'vite v8.2.1 building for production...
transforming...
ERROR: the thing that actually broke
    at someFrame
    at anotherFrame
✗ Built in 1.39s
error during build
@domicile-desktop/shell-simple:build:vite: failed
ERROR command finished with 1
Tasks:    0 successful
Cached:   0 cached
Time:     2s
Failed:   @domicile-desktop/shell-simple#build:vite
ERROR  run failed')"
expect "a build failure keeps its error, near the front" \
  "::error::build failed%0A%0AERROR  run failed%0AFailed:   @domicile-desktop/shell-simple#build:vite%0ATime:     2s%0ACached:   0 cached%0ATasks:    0 successful%0AERROR command finished with 1%0A@domicile-desktop/shell-simple:build:vite: failed%0Aerror during build%0A✗ Built in 1.39s%0A    at anotherFrame%0A    at someFrame%0AERROR: the thing that actually broke%0Atransforming...%0Avite v8.2.1 building for production..." \
  "$(annotate_from "build failed" "$BUILD_LOG")"

# A skip is a notice, not an error: an expected skip must not mark the run red.
expect "a skip is a notice, not an error" \
  "SKIP: no kitty
::notice::no kitty" \
  "$(skip "no kitty")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
