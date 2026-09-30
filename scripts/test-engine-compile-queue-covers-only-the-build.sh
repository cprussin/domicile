#!/usr/bin/env bash
# engine.yml's compile queue is held for the build and nothing after it.
#
# A compiling run waits in the `crux-compile` concurrency group. It covered the
# whole engine job, so the group was held for the checks, packaging, publish
# and write-back as well: over 24h it was held 10.9h for 5.9h of Build, and one
# cold 80-minute build kept five PRs needing ~2 minutes of compile each waiting
# 40-86 minutes.
#
# So the build is a job of its own, `build`, and only it is in the group. The
# checks are the `engine` job, outside it -- still named `engine`, the check
# name anything outside this file knows. They run in the tree the build took,
# which stays locked across the gap between the two jobs so nothing resets it,
# and a third job drops it if the checks never got to.
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
# A whole line, as written: GitHub's `cancelled()` is exempt from
# test-american-english.sh only spelled as GitHub spells it, not escaped.
has_line() { # what, line, text
  if printf '%s\n' "$3" | grep -qxF -- "$2"; then
    ok "$1"
  else
    fail "$1" "no line is: $2"
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

# The step of a job's lines that runs a command, from its `- name:` or `- uses:`
# to the next step.
step_running() { # job lines, pattern
  printf '%s\n' "$1" | awk -v p="$2" '
    /^      - / { if (hit) { exit } step = "" }
    { step = step $0 "\n" }
    $0 ~ p { hit = 1 }
    END { if (hit) { printf "%s", step } }'
}

# Where in a job's lines a pattern first matches, 0 if nowhere.
line_of() { # job lines, pattern
  printf '%s\n' "$1" | grep -nE -- "$2" | head -1 | cut -d: -f1 | grep . || echo 0
}

COMPILES='engine-build-in-shell\.sh|engine-build\.sh|engine-release-build\.sh|autoninja'

echo "the build job"
build="$(job build)"
has "engine.yml has a build job" '^  build:' "$build"
has "on crux, where the trees are" 'runs-on: \[self-hosted, crux\]' "$build"
has "that queues on the compile queue" "group: .*'crux-compile'" "$build"
has "and builds" '^      - name: Build$' "$build"
has "in a tree it takes" 'engine-tree-pool\.sh pick' "$build"
has "and hands that tree on" \
  'chromium: \$\{\{ steps\.[a-z]+\.outputs\.chromium \}\}' "$build"
lacks "and runs no checks" 'check\.sh engine|scripts/engine-guard-' "$build"
lacks "and publishes nothing" \
  'engine-release-(package|publish|repin)\.sh|engine-proof\.sh record' "$build"
# LOCKED ACROSS THE GAP. A build job that dropped its tree on success would
# hand it to whichever run picked next, which could reset it under the checks.
drop="$(step_running "$build" 'engine-tree-lock\.sh drop')"
has_line "drops the tree only if it failed or was canceled" \
  "        if: \${{ (failure() || cancelled()) && env.CHROMIUM != '' }}" "$drop"
last="$(printf '%s\n' "$build" | awk '/^      - / { step = "" } { step = step $0 "\n" } END { printf "%s", step }')"
has "and drops the compile slot last" 'engine-compile-slot\.sh drop "\$LOCK_OWNER"' "$last"
has "from a step that runs whatever happened" 'if: \$\{\{ always\(\) \}\}' "$last"

echo "the engine job"
engine="$(job engine)"
has "is still called engine, the check name everything else knows" '^  engine:' "$engine"
has "needs the build" 'needs: \[gate, build\]' "$engine"
has "on crux, which reaches every tree" 'runs-on: \[self-hosted, crux\]' "$engine"
lacks "outside the compile queue" '^    concurrency:|crux-compile' "$engine"
lacks "without taking a tree of its own" \
  'engine-tree-pool\.sh pick|engine-tree-lock\.sh take' "$engine"
lacks "and compiles no Chromium" "$COMPILES" "$engine"
has "in the tree the build took" \
  'CHROMIUM: \$\{\{ needs\.build\.outputs\.chromium \}\}' "$engine"
# RED WHEN THE BUILD IS. A skipped required check reads as passing.
has_line "runs whenever the build ran, so a red build is a red engine" \
  "    if: \${{ !cancelled() && needs.build.result != 'skipped' }}" "$engine"
has "and fails when the build did" "needs\\.build\\.result != 'success'" \
  "$(printf '%s\n' "$engine" | sed -n '/^    steps:/,/^      - uses:/p')"
holds="$(line_of "$engine" 'engine-tree-lock\.sh holds "\$CHROMIUM" "\$LOCK_OWNER"')"
checks="$(line_of "$engine" 'check\.sh engine')"
if [ "$holds" -gt 0 ] && [ "$holds" -lt "$checks" ]; then
  ok "and makes sure it still holds the tree before checking it"
else
  fail "and makes sure it still holds the tree before checking it" \
    "holds at line $holds, the checks at line $checks"
fi
for what in 'check\.sh engine' 'engine-release-package\.sh' 'engine-guard-client-window\.sh' \
            'engine-release-publish\.sh' 'engine-release-repin\.sh' 'engine-proof\.sh record'; do
  has "runs $what" "$what" "$engine"
done
has "drops the tree whatever happened" \
  'if: \$\{\{ always\(\)' "$(step_running "$engine" 'engine-tree-lock\.sh drop')"

echo "the job that drops a tree the checks never reached"
drop_tree="$(job drop-tree)"
has "engine.yml has a drop-tree job" '^  drop-tree:' "$drop_tree"
has "after both" 'needs: \[build, engine\]' "$drop_tree"
has "whenever the build took a tree and the checks did not finish" \
  "if: \\$\\{\\{ always\\(\\) && needs\\.build\\.outputs\\.chromium != '' && needs\\.engine\\.result != 'success' \\}\\}" \
  "$drop_tree"
has "on crux, where the lock is" 'runs-on: \[self-hosted, crux\]' "$drop_tree"
has "the build's tree" 'CHROMIUM: \$\{\{ needs\.build\.outputs\.chromium \}\}' "$drop_tree"
has "and drops it" 'engine-tree-lock\.sh drop "\$CHROMIUM" "\$LOCK_OWNER"' "$drop_tree"

echo "one owner across the jobs"
# The drop compares owners, so the three jobs must write the same one.
owners="$(grep -v '^[[:space:]]*#' "$ENGINE" | grep -c 'LOCK_OWNER:')"
if [ "$owners" = 1 ]; then
  ok "LOCK_OWNER is written once"
else
  fail "LOCK_OWNER is written once" "it is written $owners times"
fi
has "for the whole workflow" '^  LOCK_OWNER: engine\.yml run \$\{\{ github\.run_id \}\} attempt \$\{\{ github\.run_attempt \}\}$' \
  "$(awk '/^env:/ { inside = 1; next } inside && /^[^[:space:]]/ { inside = 0 } inside' "$ENGINE")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
