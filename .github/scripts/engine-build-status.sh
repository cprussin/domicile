#!/usr/bin/env bash
# Post an engine build's progress as a commit status, which GitHub shows on the
# pull request and the commit while the job runs.
#
#   .github/scripts/engine-build-status.sh <sha> <pending|success|failure> <description>
#
# The context is `<workflow> / build progress`, so engine.yml and
# engine-release.yml on one commit keep a status each. It links to the run.
#
# Needs GH_TOKEN with `statuses: write`. Exits 1, saying why, if GitHub refuses.
set -euo pipefail

[ $# -eq 3 ] || {
  echo "usage: $(basename "$0") <sha> <pending|success|failure> <description>" >&2
  exit 2
}
sha="$1" state="$2" description="$3"

api="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:?}/statuses/$sha"
run="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/${GITHUB_RUN_ID:?}"
# GitHub refuses a description over 140 characters.
body="$(jq -nc --arg state "$state" --arg context "${GITHUB_WORKFLOW:?} / build progress" \
  --arg description "${description:0:140}" --arg url "$run" \
  '{state: $state, context: $context, description: $description, target_url: $url}')"

if ! out="$(curl -sS -f -X POST -H "Authorization: Bearer ${GH_TOKEN:?}" \
    -H "Accept: application/vnd.github+json" -d "$body" "$api" 2>&1)"; then
  echo "could not post the build's status to $sha: $out"
  exit 1
fi
