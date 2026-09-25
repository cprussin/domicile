#!/usr/bin/env bash
# Which of a pull request's runs may be canceled, decided off a listing rather
# than off the API.
#
#   curl ... /actions/runs?branch=<ref> | .github/scripts/crux-stale-runs.sh <ref> [<keep-sha>]
#
# Prints one run id per line: the runs that are waiting for `crux` and will
# never be worth what they cost. Everything else it stays away from. Without a
# <keep-sha> that is every waiting run of the branch (it closed); with one it
# is every waiting run for any other commit (the branch moved on to that one).
#
# WHY THIS IS A FILTER AND NOT A SCRIPT THAT CANCELS. The decision is the whole
# of the risk here and the API call is not, so the decision is a pure function
# of a listing and `scripts/test-crux-stale-runs.sh` feeds it the cases —
# including the one that matters, which is a run that has already started.
#
# THE RUN THAT HAS STARTED IS OFF LIMITS. A killed `autoninja` leaves a
# half-linked out/Domicile that the next run inherits, and the failure reads as
# a code error rather than an interrupted build. That is why every crux
# workflow sets `cancel-in-progress: false`, and this must not become the thing
# that reintroduces it by another route. Only `queued` (no runner yet) and
# `pending` (held by a concurrency group) are cancelable: neither has a machine
# and neither has compiled anything.
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
  # Never started: no runner, nothing compiled, nothing to leave half-linked.
  | select(.status == "queued" or .status == "pending")
  | select(.head_branch == $branch)
  # The commit the branch is at now is the one run worth having.
  | select($keep == "" or .head_sha != $keep)
  | select(.path as $p | $crux | index($p))
  | .id
'
