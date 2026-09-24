#!/usr/bin/env bash
# The engine build runs in the merge queue, and nowhere it cannot describe
# what merges.
#
# `engine.yml` builds the fork on `crux`, one machine, and a run queues for
# hours. A `pull_request` run builds the head merged into main AS MAIN WAS
# WHEN THE EVENT FIRED, so by the time it starts main has moved and its answer
# is about a tree nobody will merge. The merge queue is the fix: the queue
# builds exactly what it is about to merge, one group at a time, and main only
# ever receives commits it tested.
#
# WHAT HAS TO HOLD FOR THAT TO WORK is GitHub's rules rather than this
# repository's, which is why it is asserted rather than remembered:
#
#   - the build runs on `merge_group`, which is the only event the queue sends;
#   - the required check is a job named `engine`, and it must REPORT on every
#     pull request, or no pull request can enter the queue. A job skipped by
#     its `if:` reports as a success; a workflow skipped by a `paths:` filter
#     reports nothing at all. So the pull request trigger stays, unfiltered,
#     and the job skips itself there;
#   - a skip in the queue has to be a decision, never an accident. When the
#     job in front of it fails, the build runs: a required check that is
#     skipped because its gate broke is a green light on nothing;
#   - main is not built again after the queue, so there is no `push` trigger,
#     and the release write-back, which used to push onto the pull request's
#     branch, pushes onto main from `engine-repin.yml` instead: the queue's
#     branch is gone by the time anything could be written to it.
#
# And the one thing that must stay out of the queue: the checks that say
# `engine-release.nix` names this series are red on every change that moves
# the fork until after it merges -- the queue publishes the release, and the
# write-back lands on main afterward. A workflow running them on `merge_group`
# would hold every such change out of the queue forever.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
ENGINE="$WORKFLOWS/engine.yml"
REPIN="$WORKFLOWS/engine-repin.yml"
[ -f "$ENGINE" ] || { echo "no $ENGINE" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
holds() { # label, why, command...
  local label="$1" why="$2"; shift 2
  if "$@"; then ok "$label"; else fail "$label" "$why"; fi
}

# A file with its whole-line comments taken out: these workflows explain
# themselves at length, and every rule here is about what they declare.
code() { grep -v '^[[:space:]]*#' "$1"; }

# The top-level `on:` block, from `on:` to the next column-zero key.
on_block() { # workflow
  code "$1" | awk '/^on:/ { inside = 1; next }
                   inside && /^[^[:space:]]/ { inside = 0 }
                   inside { print }'
}

# One event's lines out of the `on:` block: the two-space key and whatever is
# indented under it.
event() { # workflow, event
  on_block "$1" | awk -v want="$2" '
    /^  [^[:space:]]/ { key = $0; sub(/^  /, "", key); sub(/:.*/, "", key); inside = (key == want) }
    inside { print }'
}

# One job's lines, by its id: the two-space key under `jobs:` and its body.
job() { # workflow, id
  code "$1" | awk -v want="$2" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^[:space:]]/ { in_jobs = 0 }
    !in_jobs { next }
    /^  [^[:space:]]/ { key = $0; sub(/^  /, "", key); sub(/:.*/, "", key); inside = (key == want) }
    inside { print }'
}

has() { printf '%s\n' "$1" | grep -qE -e "$2"; }
# Literally, for GitHub's own function names, which are spelled their way.
has_text() { printf '%s\n' "$1" | grep -qF -e "$2"; }
lacks() { ! has "$@"; }

echo "engine.yml triggers"

holds "it runs in the merge queue" \
  "no merge_group trigger asking for checks, so the queue waits on a check that never starts" \
  has "$(event "$ENGINE" merge_group)" 'types:[[:space:]]*\[[[:space:]]*checks_requested[[:space:]]*\]'

holds "it still runs on a pull request, so the required check reports there" \
  "no pull_request trigger, so 'engine' never reports on a pull request and none can enter the queue" \
  has "$(event "$ENGINE" pull_request)" '^  pull_request:'

holds "it does not build main again after the queue" \
  "a push trigger is back; main only receives commits the queue already built" \
  lacks "$(on_block "$ENGINE")" '^  push:'

holds "a person can still dispatch it" \
  "no workflow_dispatch trigger, so nothing can build a branch or main outside the queue" \
  has "$(on_block "$ENGINE")" '^  workflow_dispatch:'

echo "the required check"

engine_job="$(job "$ENGINE" engine)"
holds "a job named engine builds on crux" \
  "no job 'engine' runs on crux, so the check the ruleset requires is not this build" \
  has "$engine_job" 'runs-on:[[:space:]]*\[self-hosted, *crux\]'

# The check's name is the job's `name:` when it has one. `engine` is what the
# ruleset names, so a display name here renames the required check out from
# under it and the queue waits on a check that never arrives.
holds "and it has no display name, so its check is called engine" \
  "the engine job carries a name:, which renames the required check" \
  lacks "$engine_job" '^    name:'

# The `if:` as one string, because it is written folded across lines.
engine_if="$(printf '%s\n' "$engine_job" |
  awk '/^    if:/ { inside = 1 } inside && /^    [a-z-]+:/ && !/^    if:/ { inside = 0 } inside { print }' |
  tr '\n' ' ')"

holds "it skips itself on a pull request, which reports as a success" \
  "its if: does not rule out pull_request, so every pull request takes the crux slot again" \
  has "$engine_if" "github\\.event_name != 'pull_request'"

holds "it asks the gate whether the change touches the engine" \
  "its if: does not read the gate's answer, so every merge group builds" \
  has "$engine_if" "needs\\.gate\\.outputs\\.touched != 'false'"

# `!= 'false'` above is half of this; `!cancelled()` is the other. Without it a
# failed gate skips the job by default, and a skipped required check passes.
holds "a gate that fails builds rather than skips" \
  "its if: has no !cancelled(), so a failed gate skips a required check, which passes" \
  has_text "$engine_if" '!cancelled()'

gate_job="$(job "$ENGINE" gate)"
holds "the gate compares the merge group's head against its base" \
  "the gate does not run engine-inputs.sh gate over the merge group's base_sha and head_sha" \
  has "$(printf '%s\n' "$gate_job" | tr '\n' ' ')" \
  'merge_group\.base_sha.*merge_group\.head_sha.*engine-inputs\.sh gate'

echo "the write-back"

# THE QUEUE'S BRANCH IS TEMPORARY. Nothing pushed onto it survives, and the
# pull request's own branch is already merged by the time a write-back could
# be. So the build publishes, and a push to main writes the pin.
holds "engine.yml pushes onto no branch" \
  "engine.yml still runs engine-release-repin.sh, onto a branch the queue deletes" \
  lacks "$(code "$ENGINE")" 'engine-release-repin\.sh'

if [ -f "$REPIN" ]; then
  holds "engine-repin.yml runs on a push to main" \
    "it does not run on push to main, so the pin is never written after a merge" \
    has "$(event "$REPIN" push | tr '\n' ' ')" 'branches:[[:space:]]*\[[[:space:]]*main[[:space:]]*\]'
  holds "it decides with the same script the build does" \
    "it does not run engine-release-needed.sh, so it answers the question a second way" \
    has "$(code "$REPIN")" 'engine-release-needed\.sh'
  holds "and writes onto main" \
    "it does not run engine-release-repin.sh main" \
    has "$(code "$REPIN")" 'engine-release-repin\.sh main'
  holds "off crux, since it builds nothing" \
    "it asks for crux, and would queue a three-line commit behind a Chromium build" \
    lacks "$(code "$REPIN")" 'self-hosted'
  holds "with the write-back token when there is one" \
    "it does not pass DOMICILE_WRITEBACK_TOKEN, so its push starts no CI on main" \
    has "$(code "$REPIN")" 'DOMICILE_WRITEBACK_TOKEN'
else
  fail "engine-repin.yml exists" "nothing writes engine-release.nix after a merge"
fi

echo "what stays out of the queue"

# The subjects are found by what they run, so a new workflow that picks up
# the shell group is in scope the day it does.
subjects=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  if code "$workflow" | grep -qE 'check\.sh[^|&;]*\bshell\b' ||
     code "$workflow" | grep -qE 'nix build[^|&;]*\.#engine'; then
    subjects=$((subjects + 1))
    holds "$name stays out of the merge queue" \
      "it runs on merge_group and checks the pin, which is red on every fork change until after it merges" \
      lacks "$(on_block "$workflow")" '^  merge_group:'
  fi
done
holds "the checks of the pin were found at all ($subjects)" \
  "nothing runs check.sh shell or builds .#engine, so the rule above asserted nothing" \
  [ "$subjects" -ge 2 ]

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
