#!/usr/bin/env bash
# Whether a started run is in a step it may be stopped in.
#
#   curl ... /actions/runs/<id>/jobs | .github/scripts/crux-cancelable-step.sh
#                                       0 yes, 1 no, else could not read it
#
# May be stopped:
# - A run with no job in progress: queued for the compile slot or a runner, or
#   between engine.yml's build and checks. engine.yml's drop-tree job releases
#   its tree when it is canceled.
# - engine.yml's build and check steps. A canceled build resumes incrementally:
#   lld and clang write through a temp file and rename, and the series stamp
#   and out/Release stay.
# Later steps (publishing a release, writing engine-release.nix back to the
# branch, recording the proof) cannot be repeated, so they are left alone.
#
# Not named `engine-*.sh`; see crux-stale-runs.sh.
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
