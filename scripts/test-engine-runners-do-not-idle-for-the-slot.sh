#!/usr/bin/env bash
# Asserts a run that will compile queues on GitHub for the compile slot, not
# on a `crux` runner.
#
# `crux` and `crux-two` share one compile slot. A job waiting in
# `engine-compile-slot.sh take` holds its runner idle, so runs that compile
# nothing queue behind it. A `plan` job asks the pool whether this run's tree
# is already built from its series; only if not does the build job join the
# compile concurrency group. A pending job holds no runner, and `queue: max`
# keeps every pending run.
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

# One job's lines with comments removed, from `  <job>:` to the next job.
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
has "with whether that compile is cold" 'cold: \$\{\{ steps\.[a-z]+\.outputs\.cold \}\}' "$plan"
lacks "without taking a tree" 'engine-tree-pool\.sh pick|engine-tree-lock\.sh take' "$plan"

echo "the build job"
build="$(job build)"
has "needs the plan" 'needs: \[gate, plan\]' "$build"
queue="$(concurrency_of "$build")"
# Use a compile queue unless the plan said no compile: a failed or skipped plan
# gives no answer, and queueing is the safe default. Use the warm queue only if
# the plan said warm, so a long cold compile does not delay warm ones.
has "queues on a compile queue unless the plan said it compiles nothing, the warm one only if it said warm" \
  "group: \\$\\{\\{ needs\\.plan\\.outputs\\.compile == 'false' && .* \\|\\| needs\\.plan\\.outputs\\.cold == 'false' && 'crux-compile' \\|\\| 'crux-compile-cold' \\}\\}" "$queue"
has "and otherwise on a group of its own run" \
  "group: .*github\\.run_id.*github\\.run_attempt" "$queue"
has "keeping every pending run, not the newest" '^[[:space:]]*queue: max$' "$queue"
lacks "and never canceling a run in progress" 'cancel-in-progress: true' "$queue"

# The slot remains as a backstop for a stale plan and for engine-release.yml,
# which compiles in the same trees.
has "and still takes the compile slot before compiling" \
  'engine-compile-slot\.sh take "\$LOCK_OWNER"' "$build"

# Both queues share one slot, so a warm compile could still wait on a runner
# for a cold one. A cold build (rank 1) yields the slot to it, and
# engine-release.yml's build (rank 0) yields to both.
has "a cold build ranks 1 for the slot" \
  "DOMICILE_COMPILE_SLOT_RANK: \\$\\{\\{ needs\\.plan\\.outputs\\.cold != 'false' && '1' \\|\\| '' \\}\\}" "$build"
step="$(printf '%s\n' "$build" | awk '/^      - / { if (hit) { exit } step = "" }
  { step = step $0 "\n" } /^      - name: Build$/ { hit = 1 } END { printf "%s", step }')"
has "and steps aside while it holds the slot" \
  "STEP_ASIDE: \\$\\{\\{ needs\\.plan\\.outputs\\.cold != 'false' && steps\\.slot\\.outcome == 'success' \\}\\}" "$step"
has "through the yielding build" 'engine-yielding-build\.sh "\$LOCK_OWNER" --' "$step"
has "waiting to take it back as long as the slot step waits" 'DOMICILE_COMPILE_SLOT_WAIT: 36000' "$step"
release="$(grep -v '^[[:space:]]*#' "$ROOT/.github/workflows/engine-release.yml")"
has "and the production build ranks 0, below it" 'DOMICILE_COMPILE_SLOT_RANK: 0$' "$release"

# The other crux workflows keep per-ref groups (test-engine-concurrency.sh), so
# none may use this queue's name.
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
