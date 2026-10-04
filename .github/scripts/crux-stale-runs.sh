#!/usr/bin/env bash
# Which of a branch's `crux` runs may be canceled, read from a run listing.
#
#   curl ... /actions/runs?branch=<ref> | .github/scripts/crux-stale-runs.sh <ref> [<keep-sha>]
#
# Prints one run id per line:
# - Without <keep-sha> (the pull request closed): every queued or pending run.
# - With <keep-sha> (the branch moved to it): every run for another commit,
#   started or not. Started runs count only for pull requests from this
#   repository, never pushes, so never main's.
#
# A filter rather than a canceler, so `scripts/test-crux-stale-runs.sh` can
# test the decision without the API.
#
# Canceling a build is safe: lld and clang write through a temp file and
# rename, and the next run resumes from the series stamp and out/Release. The
# workflow also checks each run with crux-still-head.sh and
# crux-cancelable-step.sh before canceling it.
#
# Not named `engine-*.sh`: engine.yml runs on changes to those because its
# steps are those scripts (see `test-engine-path-filter.sh`). A change to this
# script would queue a Chromium build on `crux` for nothing.
#
# Scoped by the `self-hosted, crux` runner label, not by workflow name: the cost
# is the single `crux` job slot, so any workflow that asks for that runner is in
# scope. `test-engine-concurrency.sh` decides the same way.
set -euo pipefail

BRANCH="${1:?usage: crux-stale-runs.sh <head branch> [<keep sha>] < runs.json}"
KEEP="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOWS="${DOMICILE_WORKFLOWS:-$ROOT/.github/workflows}"

# The workflows that ask for the machine, by the label they ask with.
crux_workflows="$(
  for workflow in "$WORKFLOWS"/*.yml; do
    [ -e "$workflow" ] || continue
    grep -q 'self-hosted, *crux' "$workflow" || continue
    printf '.github/workflows/%s\n' "$(basename "$workflow")"
  done
)"

# Fail rather than print nothing: an empty list would read as "nothing to
# cancel" when the label or directory moved or this ran outside the repository.
[ -n "$crux_workflows" ] || {
  echo "::error::no workflow under $WORKFLOWS asks for a 'self-hosted, crux' runner" >&2
  echo "Either the runner label changed or this ran outside the repository." >&2
  echo "Whichever it is, this filter can no longer tell which runs hold that slot." >&2
  exit 1
}

jq -r --arg branch "$BRANCH" --arg keep "$KEEP" --arg paths "$crux_workflows" '
  ($paths | split("\n")) as $crux
  | .workflow_runs[]
  # Never started; or, once the branch has moved on, started by this
  # pull request from this repository -- never a push, so never main.
  | select(.status == "queued" or .status == "pending"
      or ($keep != "" and .status == "in_progress" and .event == "pull_request"
          and .head_repository.full_name == .repository.full_name))
  | select(.head_branch == $branch)
  # The commit the branch is at now is the one run worth having.
  | select($keep == "" or .head_sha != $keep)
  | select(.path as $p | $crux | index($p))
  | .id
'
