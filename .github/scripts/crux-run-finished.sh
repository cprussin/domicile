#!/usr/bin/env bash
# Whether the workflow run a lock's owner names is over.
#
#   crux-run-finished.sh "<workflow>.yml run <id> attempt <n>"
#                         0 over, 1 still going, 3 could not ask
#
# engine.yml and engine-release.yml ask this about the compile slot's holder
# while they wait for it. A runner shut down mid-build never drops the slot,
# and until this only that same runner could clear it.
#
# Not named `engine-*.sh`, for crux-stale-runs.sh's reason: engine.yml runs on
# changes to those, and a change to this is not a change to the build.
set -u

[ $# -eq 1 ] || { echo "usage: $(basename "$0") '<workflow>.yml run <id> attempt <n>'" >&2; exit 2; }
if [[ ! "$1" =~ ^[a-z.-]+\.yml\ run\ ([0-9]+)\ attempt\ ([0-9]+)$ ]]; then
  echo "'$1' names no workflow run"
  exit 3
fi
run="${BASH_REMATCH[1]}"
attempt="${BASH_REMATCH[2]}"

api="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:?}/actions/runs/$run/attempts/$attempt"
if ! body="$(curl -sS -f -H "Authorization: Bearer ${GH_TOKEN:?}" \
    -H "Accept: application/vnd.github+json" "$api" 2>&1)"; then
  echo "could not ask GitHub about run $run attempt $attempt: $body"
  exit 3
fi
status="$(printf '%s' "$body" | jq -r .status 2>/dev/null)"
case "$status" in
  completed) echo "run $run attempt $attempt is completed" ;;
  ''|null) echo "GitHub said nothing about run $run attempt $attempt's status"; exit 3 ;;
  *) echo "run $run attempt $attempt is $status"; exit 1 ;;
esac
