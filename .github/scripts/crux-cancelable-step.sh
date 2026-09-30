#!/usr/bin/env bash
# Whether a started run is in a step it may be stopped in.
#
#   curl ... /actions/runs/<id>/jobs | .github/scripts/crux-cancelable-step.sh
#                                       0 yes, 1 no, else could not read it
#
# A run with no job running may be stopped: queued on GitHub for the compile
# slot or for a runner, or between engine.yml's build and its checks. That last
# one holds its tree, and engine.yml's drop-tree job gives it back on a
# canceled run; nothing it cannot repeat has happened yet. Otherwise only
# engine.yml's long, repeatable steps. A canceled build resumes
# incrementally: lld and clang write through a temp file and rename, so nothing
# is left half-written, and the series stamp and out/Release stay. What comes
# after them -- publishing a release, writing engine-release.nix back onto the
# branch, recording the proof -- is not repeatable that way, and the write-back
# is itself a push to the branch.
#
# Not named `engine-*.sh`, for crux-stale-runs.sh's reason.
set -euo pipefail

jobs="$(cat)"
if [ "$(printf '%s' "$jobs" | jq '[.jobs[] | select(.status == "in_progress")] | length')" = 0 ]; then
  echo "in no job, so it may be stopped: a tree it holds between jobs goes back in drop-tree"
  exit 0
fi
step="$(printf '%s' "$jobs" | jq -r '[.jobs[] | select(.status == "in_progress") | .steps[]
                | select(.status == "in_progress") | .name] | first // ""')"
case "$step" in
  ("Build"|"The engine's checks") echo "in '$step', which may be stopped" ;;
  (*) echo "in '${step:-no step}', which is left alone"; exit 1 ;;
esac
