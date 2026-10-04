#!/usr/bin/env bash
# Asserts engine-release.yml builds on a schedule, not on every engine merge.
#
# Building per merge cost 10-12 official builds a day and queued pull
# requests' engine jobs on crux. Nothing pins `engine-official-*`, so a nightly
# build of main is enough.
#
# Triggers: a nightly cron, a dispatch, and tag pushes; no branch pushes. The
# concurrency group (asserted by scripts/test-engine-concurrency.sh) keeps one
# run and one pending, so a dispatch during the nightly queues after it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/engine-release.yml"
[ -f "$WORKFLOW" ] || { echo "no $WORKFLOW" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A top-level block's lines with comments removed, from `<key>:` at column zero
# to the next column-zero line.
top_block() { # key
  sed 's/[[:space:]]*#.*$//' "$WORKFLOW" |
    awk -v key="$1:" '$0 == key { inside = 1; next }
                      inside && /^[^[:space:]]/ { inside = 0 }
                      inside && NF { print }'
}

# One trigger's lines out of `on:`, from `  <name>:` to the next trigger.
trigger() { # name
  top_block on |
    awk -v key="  $1:" 'index($0, key) == 1 { inside = 1; next }
                        inside && /^  [^[:space:]]/ { inside = 0 }
                        inside { print }'
}

on="$(top_block on)"
[ -n "$on" ] || { echo "no top-level on: in $WORKFLOW" >&2; exit 1; }

if trigger push | grep -q 'branches:'; then
  fail "a merge to main does not start an official build" \
    "on.push has branches:, so every engine merge is hours on crux"
else
  ok "a merge to main does not start an official build"
fi

if trigger schedule | grep -qE -- "- cron: *['\"][0-9*]"; then
  ok "it builds on a schedule ($(trigger schedule | sed -n 's/.*cron: *//p' | head -1))"
else
  fail "it builds on a schedule" "on.schedule has no cron"
fi

if printf '%s\n' "$on" | grep -qE '^  workflow_dispatch:'; then
  ok "it can be dispatched by hand"
else
  fail "it can be dispatched by hand" "on has no workflow_dispatch"
fi

if trigger push | grep -q 'tags:'; then
  ok "a pushed engine-v* tag still publishes"
else
  fail "a pushed engine-v* tag still publishes" "on.push has no tags:"
fi

[ "$FAILED" = "0" ] || exit 1
echo "PASS: engine-release.yml builds nightly or on request, never per merge"
