#!/usr/bin/env bash
# Tests `crux-stale-runs.sh`, which picks the engine runs a closed or updated
# pull request leaves behind on `crux`.
#
# `crux` has one job slot, and GitHub still dispatches a queued run after its
# pull request merges. The filter must cancel every stale run and leave the
# rest alone:
#
# - On a close, it never cancels a started run.
# - On a push, it keeps the head's runs, main's runs, and other branches' and
#   forks' runs. A started run for a replaced commit is canceled only in steps
#   `crux-cancelable-step.sh` allows.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILTER="$ROOT/.github/scripts/crux-stale-runs.sh"
[ -x "$FILTER" ] || { echo "no $FILTER" >&2; exit 1; }

command -v jq >/dev/null || { echo "  SKIP: no jq"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}

# Real workflow paths from this repository, since the filter decides by which
# workflow asks for `crux`.
CRUX_WORKFLOW=".github/workflows/engine.yml"
HOSTED_WORKFLOW=".github/workflows/cargo-test.yml"
grep -q 'self-hosted, *crux' "$ROOT/$CRUX_WORKFLOW" ||
  { echo "fixture is stale: $CRUX_WORKFLOW no longer runs on crux" >&2; exit 1; }
! grep -q 'self-hosted, *crux' "$ROOT/$HOSTED_WORKFLOW" ||
  { echo "fixture is stale: $HOSTED_WORKFLOW now runs on crux" >&2; exit 1; }

REPO="cprussin/domicile"
run() { # id, status, branch, workflow path, head sha, event, head repository
  printf '{"id":%s,"status":"%s","head_branch":"%s","path":"%s","head_sha":"%s","event":"%s","head_repository":{"full_name":"%s"},"repository":{"full_name":"%s"}}' \
    "$1" "$2" "$3" "$4" "${5:-old}" "${6:-pull_request}" "${7:-$REPO}" "$REPO"
}
runs_json() { printf '{"workflow_runs":[%s]}' "$(printf '%s,' "$@" | sed 's/,$//')"; }

BRANCH="claude/a-merged-branch"
filter() { printf '%s' "$1" | "$FILTER" "$BRANCH" 2>&1; }

# ---- what gets canceled --------------------------------------------------

waiting_for_the_runner="$(run 101 queued "$BRANCH" "$CRUX_WORKFLOW")"
held_by_the_group="$(run 102 pending "$BRANCH" "$CRUX_WORKFLOW")"
expect "a queued run on the closed branch is canceled" "101" \
  "$(filter "$(runs_json "$waiting_for_the_runner")")"
# A `pending` run is held by a concurrency group. It has no runner and has
# compiled nothing, so canceling it is safe.
expect "a run the concurrency group is holding is canceled too" "102" \
  "$(filter "$(runs_json "$held_by_the_group")")"
expect "both, when both are there" "$(printf '101\n102')" \
  "$(filter "$(runs_json "$waiting_for_the_runner" "$held_by_the_group")")"

# ---- what must survive ---------------------------------------------------

# A close takes only runs that never started.
building="$(run 103 in_progress "$BRANCH" "$CRUX_WORKFLOW")"
expect "a closed branch's run that has STARTED is left alone" "" \
  "$(filter "$(runs_json "$building")")"

finished="$(run 104 completed "$BRANCH" "$CRUX_WORKFLOW")"
expect "a finished run is left alone" "" "$(filter "$(runs_json "$finished")")"

somebody_else="$(run 105 queued "claude/still-open" "$CRUX_WORKFLOW")"
expect "another branch's queued run is left alone" "" \
  "$(filter "$(runs_json "$somebody_else")")"

# Only `crux` runs. Hosted runners are elastic, so a stale run there blocks
# nobody.
hosted="$(run 106 queued "$BRANCH" "$HOSTED_WORKFLOW")"
expect "a stale run on a hosted runner is not ours to cancel" "" \
  "$(filter "$(runs_json "$hosted")")"

# A mixed API response.
expect "the whole mixture, decided one run at a time" "$(printf '101\n102')" \
  "$(filter "$(runs_json "$waiting_for_the_runner" "$held_by_the_group" \
                         "$building" "$finished" "$somebody_else" "$hosted")")"

# ---- a branch that moved on -----------------------------------------------

# A push also makes the branch's older runs stale. Given the branch's current
# commit, the filter keeps that commit's runs and cancels the rest.
moved() { printf '%s' "$1" | "$FILTER" "$BRANCH" new 2>&1; }
old_queued="$(run 201 queued "$BRANCH" "$CRUX_WORKFLOW" old)"
new_pending="$(run 202 pending "$BRANCH" "$CRUX_WORKFLOW" new)"
old_building="$(run 203 in_progress "$BRANCH" "$CRUX_WORKFLOW" old)"
expect "a run for a commit the branch has moved past is canceled" "201" \
  "$(moved "$(runs_json "$old_queued")")"
expect "the run for the commit it is at now is kept" "" \
  "$(moved "$(runs_json "$new_pending")")"
# A started run for a replaced commit is also canceled: `crux` spent about
# 5h/day building replaced commits. A killed build is safe because lld and
# clang write to a temp file and rename, and the next run resumes
# incrementally. `crux-cancelable-step.sh` decides which steps allow it (below).
expect "a started run for a commit the branch moved past is canceled too" "203" \
  "$(moved "$(runs_json "$old_building")")"
expect "all three at once" "$(printf '201\n203')" \
  "$(moved "$(runs_json "$old_queued" "$new_pending" "$old_building")")"

new_building="$(run 204 in_progress "$BRANCH" "$CRUX_WORKFLOW" new)"
expect "the started run for the commit it is at now is kept" "" \
  "$(moved "$(runs_json "$new_building")")"

other_building="$(run 205 in_progress "claude/still-open" "$CRUX_WORKFLOW" old)"
expect "another branch's started run is left alone" "" \
  "$(moved "$(runs_json "$other_building")")"

# Main's runs are push runs, which this workflow never stops, even for a pull
# request whose head is `main`.
main_building="$(run 206 in_progress main "$CRUX_WORKFLOW" old push)"
expect "a started push run on main is left alone" "" \
  "$(printf '%s' "$(runs_json "$main_building")" | "$FILTER" main new 2>&1)"

# A fork's branch is not on origin, so it cannot be checked.
fork_building="$(run 207 in_progress "$BRANCH" "$CRUX_WORKFLOW" old pull_request someone/domicile)"
expect "a started run from a fork is left alone" "" \
  "$(moved "$(runs_json "$fork_building")")"

# ---- which step a started run may be stopped in ---------------------------

# Only the build and the checks may be stopped. Later steps publish a release
# and push engine-release.nix to the branch; that push fires `synchronize`,
# which must not cancel the run before it records its proof.
STEP="$ROOT/.github/scripts/crux-cancelable-step.sh"
jobs_json() { # the step in progress, the job it is in
  printf '{"jobs":[{"name":"gate","status":"completed","steps":[{"name":"Prove","status":"completed"}]},{"name":"%s","status":"in_progress","steps":[{"name":"Set up job","status":"completed"},{"name":"%s","status":"in_progress"}]}]}' "$2" "$1"
}
step() { printf '%s' "$(jobs_json "$1" "$2")" | "$STEP" >/dev/null 2>&1; echo $?; }
# Checks that engine.yml runs each step in the named job.
in_job() { # step, job
  awk -v j="  $2:" -v s="      - name: $1" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^  [a-z][a-z-]*:[[:space:]]*$/ { inside = ($0 == j) }
    inside && $0 == s { found = 1 }
    END { exit !found }' "$ROOT/$CRUX_WORKFLOW"
}
for pair in "Build:build" "The engine's checks:engine"; do
  name="${pair%:*}" job="${pair##*:}"
  in_job "$name" "$job" ||
    { echo "fixture is stale: $CRUX_WORKFLOW's $job job has no step '$name'" >&2; exit 1; }
  expect "a run in '$name' may be stopped" 0 "$(step "$name" "$job")"
done
for pair in "Take a tree:build" "Publish the release:engine" \
            "Write engine-release.nix back onto this branch:engine" "Record the proof:engine" \
            "Drop the tree:drop-tree"; do
  expect "a run in '${pair%:*}' is left alone" 1 "$(step "${pair%:*}" "${pair##*:}")"
done
# Between its build and its checks, a run holds its tree with no job running.
# Stopping it is safe: engine.yml's drop-tree job returns the tree on cancel.
expect "a run between its build and its checks may be stopped" 0 \
  "$(printf '{"jobs":[{"name":"build","status":"completed","steps":[{"name":"Build","status":"completed"}]},{"name":"engine","status":"queued","steps":[]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"
contains "and it says the tree is given back" "drop-tree" \
  "$(printf '{"jobs":[{"name":"build","status":"completed","steps":[{"name":"Build","status":"completed"}]},{"name":"engine","status":"queued","steps":[]}]}' |
       "$STEP" 2>&1)"
# A run with no job started holds nothing on `crux`, so stopping it is safe.
expect "a run whose jobs are all waiting or done may be stopped" 0 \
  "$(printf '{"jobs":[{"name":"plan","status":"completed","steps":[{"name":"Would this run compile?","status":"completed"}]},{"name":"engine","status":"waiting","steps":[]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"
expect "a run between steps is left alone" 1 \
  "$(printf '{"jobs":[{"name":"engine","status":"in_progress","steps":[{"name":"Build","status":"completed"}]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"

# The workflow runs the filter on push and on close, passing the new head on a
# push and nothing on a close.
CANCELER="$ROOT/.github/workflows/engine-cancel-stale.yml"
[ -f "$CANCELER" ]
expect "the canceler is engine-cancel-stale.yml" 0 "$?"
grep -q 'types: \[closed, synchronize\]' "$CANCELER"
expect "it runs on a push to the branch as well as a close" 0 "$?"
grep -q "crux-stale-runs.sh \"\$BRANCH\" \"\$KEEP\"" "$CANCELER"
expect "and hands the filter the commit to keep" 0 "$?"
grep -q "KEEP: \${{ github.event.action == 'synchronize' && github.event.pull_request.head.sha || '' }}" "$CANCELER"
expect "which is the new head on a push and nothing on a close" 0 "$?"
grep -q 'crux-still-head.sh "$BRANCH" "$sha"' "$CANCELER"
expect "a started run is canceled only once its commit is not the branch's head" 0 "$?"
grep -q 'crux-cancelable-step.sh' "$CANCELER"
expect "and only in a step it may be stopped in" 0 "$?"

# ---- the silent-no-op cases ----------------------------------------------

expect "no runs at all is not an error" "" "$(filter '{"workflow_runs":[]}')"

# A filter that matches nothing prints nothing, like one with nothing to do.
# If it cannot find any `crux` workflow, it must fail, or a renamed runner
# label would make it a silent no-op.
out="$(DOMICILE_WORKFLOWS="$WORK/no-workflows-here" filter "$(runs_json "$waiting_for_the_runner")")"
status=$?
expect "a workflow directory with no crux workflow in it is refused" "1" \
  "$( [ "$status" -ne 0 ] && echo 1 || echo 0 )"
contains "and it says the label is what it could not find" "crux" "$out"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
