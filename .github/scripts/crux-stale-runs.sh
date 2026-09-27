#!/usr/bin/env bash
# Which of a pull request's runs may be canceled, decided off a listing rather
# than off the API.
#
#   curl ... /actions/runs?branch=<ref> | .github/scripts/crux-stale-runs.sh <ref> [<keep-sha>]
#
# Prints one run id per line: the runs of `crux` that will never be worth what
# they cost. Everything else it stays away from. Without a <keep-sha> that is
# every waiting run of the branch (it closed); with one it is every run for any
# other commit (the branch moved on to that one), started or not.
#
# WHY THIS IS A FILTER AND NOT A SCRIPT THAT CANCELS. The decision is the whole
# of the risk here and the API call is not, so the decision is a pure function
# of a listing and `scripts/test-crux-stale-runs.sh` feeds it the cases.
#
# A STARTED RUN IS TAKEN ONLY FOR A REPLACED COMMIT, and only a pull request's
# from this repository: never a push, so never main's. A 24h sample found about
# 5h/day of builds for commits already replaced. Canceling one mid-build is
# safe for the tree: lld and clang write through a temp file and rename, so
# nothing is left half-written, and the next run resumes incrementally from the
# series stamp and out/Release. The workflow still asks, per run, whether its
# commit is the head right now (crux-still-head.sh) and whether it is in a
# step that may be stopped (crux-cancelable-step.sh). On a close only `queued`
# and `pending` runs are taken, as before.
#
# NOT NAMED `engine-*.sh`, AND THAT IS LOAD-BEARING RATHER THAN TASTE.
# `engine.yml` fires on `.github/scripts/engine-*.sh` because, as
# `test-engine-path-filter.sh` puts it, the steps of that job ARE those
# scripts. This one is not: the engine job never runs it. Named into that
# glob, it queued a half-hour Chromium build on the one machine every time it
# changed — which is the exact waste the workflow above it exists to stop, and
# it did it on its own first pull request.
#
# SCOPED TO crux, BY THE LABEL RATHER THAN BY FILENAME. The cost this exists to
# stop is one job slot held for half an hour; a hosted runner is elastic and a
# stale run on one is somebody's minutes rather than everybody's queue. A fifth
# workflow that reaches for that tree is in scope the moment it asks for the
# runner, whatever it is called — which is how `test-engine-concurrency.sh`
# decides the same question.
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

# A FILTER THAT RECOGNIZES NOTHING PRINTS NOTHING, and an empty answer here is
# indistinguishable from "there was nothing to cancel". So this is the one
# condition that fails rather than returning quietly: it means the label moved,
# the directory moved, or this is being run from somewhere it cannot see the
# workflows, and in every one of those cases a silent success is a lie.
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
