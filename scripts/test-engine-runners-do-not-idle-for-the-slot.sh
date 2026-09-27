#!/usr/bin/env bash
# A run that will compile queues for the compile slot on GitHub, not on a
# `crux` runner.
#
# `crux` and `crux-two` share one compile slot. A job that took a runner and
# then waited in `engine-compile-slot.sh take` held that runner idle: over 24h,
# 22.8 runner-hours, while runs that compile nothing queued for a runner
# (36194734502: 200 minutes queued for a 6-minute run).
#
# So a `plan` job asks the pool whether the tree this run would get is already
# built from its series, and the engine job's concurrency group is the compile
# queue only when it is not. A pending job holds no runner, and `queue: max`
# keeps every pending run rather than evicting all but one.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/.github/workflows/engine.yml"
[ -f "$ENGINE" ] || { echo "no $ENGINE" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
has() { # what, pattern, text
  if printf '%s\n' "$3" | grep -qE -- "$2"; then
    ok "$1"
  else
    fail "$1" "no line matches: $2"
  fi
}
lacks() { # what, pattern, text
  if printf '%s\n' "$3" | grep -qE -- "$2"; then
    fail "$1" "a line matches: $2"
  else
    ok "$1"
  fi
}

# One job's lines, comments out: from `  <job>:` to the next job.
job() { # name
  awk -v j="  $1:" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^  [a-z][a-z-]*:[[:space:]]*$/ { inside = ($0 == j) }
    inside { print }' "$ENGINE" | grep -v '^[[:space:]]*#'
}

# The job-level `concurrency:` block of a job's lines.
concurrency_of() { # job lines
  printf '%s\n' "$1" | awk '
    /^    concurrency:/ { inside = 1; next }
    inside && /^    [^[:space:]]/ { inside = 0 }
    inside { print }'
}

echo "the plan"
plan="$(job plan)"
has "engine.yml has a plan job" '^  plan:' "$plan"
has "on crux, where the trees are" 'runs-on: \[self-hosted, crux\]' "$plan"
has "that asks the pool whether this run compiles" 'engine-tree-pool\.sh compiles ' "$plan"
has "and hands the answer on" 'compile: \$\{\{ steps\.[a-z]+\.outputs\.compile \}\}' "$plan"
lacks "without taking a tree" 'engine-tree-pool\.sh pick|engine-tree-lock\.sh take' "$plan"

echo "the engine job"
engine="$(job engine)"
has "needs the plan" 'needs: \[gate, plan\]' "$engine"
queue="$(concurrency_of "$engine")"
# The compile queue unless the plan positively said no compile: a plan that
# failed or was skipped answers nothing, and queueing is the safe side.
has "queues on the compile queue unless the plan said it compiles nothing" \
  "group: \\$\\{\\{ needs\\.plan\\.outputs\\.compile == 'false' && .* \\|\\| 'crux-compile' \\}\\}" "$queue"
has "and otherwise on a group of its own run" \
  "group: .*github\\.run_id.*github\\.run_attempt" "$queue"
has "keeping every pending run, not the newest" '^[[:space:]]*queue: max$' "$queue"
lacks "and never canceling a run in progress" 'cancel-in-progress: true' "$queue"

# The slot stays, as the backstop for a guess that went stale and for
# engine-release.yml, which compiles in the same trees.
has "and still takes the compile slot before compiling" \
  'engine-compile-slot\.sh take "\$LOCK_OWNER"' "$engine"

# THE CRUX WORKFLOWS' OWN GROUPS STAY PER REF (test-engine-concurrency.sh), so
# no other workflow may queue on this one's name by accident.
others="$(for flow in "$ROOT"/.github/workflows/*.yml; do
  [ "$(basename "$flow")" = engine.yml ] && continue
  grep -v '^[[:space:]]*#' "$flow" | grep -q 'crux-compile' && basename "$flow"
done)"
if [ -z "$others" ]; then
  ok "only engine.yml queues on crux-compile"
else
  fail "only engine.yml queues on crux-compile" "also: $others"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
