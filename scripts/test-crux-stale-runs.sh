#!/usr/bin/env bash
# Which runs a closed or moved-on pull request leaves behind, and which of them
# may be canceled.
#
# `crux` has one job slot and an engine run holds it for half an hour. GitHub
# dispatches a queued run whether or not the pull request that created it still
# exists, so a merged branch's run still builds — on 2026-09-19 two of them did,
# for #460 and #461, both merged hours earlier, while three open pull requests
# waited behind them. That is an hour of the only machine that can build the
# fork, spent on answers nobody can act on.
#
# THE DANGEROUS HALF IS THE ONE THAT MUST NOT BE CANCELED. On a close that is
# every run that has started. On a push it is the head's run, main's runs,
# other branches' and forks' runs: a started run for a commit the branch moved
# past is taken, in the steps crux-cancelable-step.sh allows.
#
# So the filter has two jobs and this asserts both: take every stale run, and
# leave everything else alone.
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

# A real crux workflow's path and a real hosted one's, read from this
# repository rather than invented: the filter decides by which workflow asks
# for the machine, so a fixture naming a file that is not one of those proves
# nothing.
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
# `pending` is a run a concurrency group is holding — it has no runner and has
# compiled nothing, so it is as safe to cancel as a queued one and as useless
# to keep.
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

# Scoped to the machine this is about. A hosted runner is elastic — a stale run
# there costs minutes nobody is waiting on, and canceling it buys nothing that
# would justify reaching for other workflows' runs.
hosted="$(run 106 queued "$BRANCH" "$HOSTED_WORKFLOW")"
expect "a stale run on a hosted runner is not ours to cancel" "" \
  "$(filter "$(runs_json "$hosted")")"

# All of it at once, which is what a real answer from the API looks like.
expect "the whole mixture, decided one run at a time" "$(printf '101\n102')" \
  "$(filter "$(runs_json "$waiting_for_the_runner" "$held_by_the_group" \
                         "$building" "$finished" "$somebody_else" "$hosted")")"

# ---- a branch that moved on -----------------------------------------------

# A PUSH MAKES THE BRANCH'S OLDER RUNS STALE TOO, not only a close: on
# 2026-09-25 #578 and #579 each had a queued run for a commit they had already
# pushed past, ahead of the run for the commit that mattered. So given the
# commit the branch is at now, the filter keeps that commit's runs and takes
# the rest -- by the same never-started rule.
moved() { printf '%s' "$1" | "$FILTER" "$BRANCH" new 2>&1; }
old_queued="$(run 201 queued "$BRANCH" "$CRUX_WORKFLOW" old)"
new_pending="$(run 202 pending "$BRANCH" "$CRUX_WORKFLOW" new)"
old_building="$(run 203 in_progress "$BRANCH" "$CRUX_WORKFLOW" old)"
expect "a run for a commit the branch has moved past is canceled" "201" \
  "$(moved "$(runs_json "$old_queued")")"
expect "the run for the commit it is at now is kept" "" \
  "$(moved "$(runs_json "$new_pending")")"
# A STARTED RUN FOR A REPLACED COMMIT IS CANCELED TOO, once the branch has
# moved on: a 24h sample found about 5h/day of `crux` building commits already
# replaced (runs 36190376822, 36201672013, 36208702812, 36217378847). Safe for
# the tree: lld and clang write to a temp file and rename, so a killed build
# leaves no half-written output, and the next run resumes incrementally. Which
# step it may be stopped in is crux-cancelable-step.sh's call, below.
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

# Main's runs are pushes, and a push run is never this workflow's to stop: a
# pull request whose head is `main` must not reach them.
main_building="$(run 206 in_progress main "$CRUX_WORKFLOW" old push)"
expect "a started push run on main is left alone" "" \
  "$(printf '%s' "$(runs_json "$main_building")" | "$FILTER" main new 2>&1)"

# Same name, somebody else's repository: its branch is not on origin to ask.
fork_building="$(run 207 in_progress "$BRANCH" "$CRUX_WORKFLOW" old pull_request someone/domicile)"
expect "a started run from a fork is left alone" "" \
  "$(moved "$(runs_json "$fork_building")")"

# ---- which step a started run may be stopped in ---------------------------

# ONLY THE LONG, REPEATABLE STEPS. After them come publishing a release and
# writing engine-release.nix back onto the branch -- a push that fires
# `synchronize` itself, and would otherwise cancel the run that made it before
# it recorded its proof.
STEP="$ROOT/.github/scripts/crux-cancelable-step.sh"
jobs_json() { # the step in progress, the job it is in
  printf '{"jobs":[{"name":"gate","status":"completed","steps":[{"name":"Prove","status":"completed"}]},{"name":"%s","status":"in_progress","steps":[{"name":"Set up job","status":"completed"},{"name":"%s","status":"in_progress"}]}]}' "$2" "$1"
}
step() { printf '%s' "$(jobs_json "$1" "$2")" | "$STEP" >/dev/null 2>&1; echo $?; }
# Each in the job engine.yml runs it in: the build in `build`, the checks in
# `engine`.
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
# BETWEEN ITS BUILD AND ITS CHECKS a run holds its tree with no job running.
# Stopping it there is still free: nothing it cannot repeat has happened, and
# engine.yml's drop-tree job gives the tree back on a canceled run.
expect "a run between its build and its checks may be stopped" 0 \
  "$(printf '{"jobs":[{"name":"build","status":"completed","steps":[{"name":"Build","status":"completed"}]},{"name":"engine","status":"queued","steps":[]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"
contains "and it says the tree is given back" "drop-tree" \
  "$(printf '{"jobs":[{"name":"build","status":"completed","steps":[{"name":"Build","status":"completed"}]},{"name":"engine","status":"queued","steps":[]}]}' |
       "$STEP" 2>&1)"
# A run with no job started -- its build job queued on GitHub for the compile
# slot, or for a runner -- holds nothing on crux, so stopping it is free.
expect "a run whose jobs are all waiting or done may be stopped" 0 \
  "$(printf '{"jobs":[{"name":"plan","status":"completed","steps":[{"name":"Would this run compile?","status":"completed"}]},{"name":"engine","status":"waiting","steps":[]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"
expect "a run between steps is left alone" 1 \
  "$(printf '{"jobs":[{"name":"engine","status":"in_progress","steps":[{"name":"Build","status":"completed"}]}]}' |
       "$STEP" >/dev/null 2>&1; echo $?)"

# And the workflow that runs it does so on a push to the branch as well as on
# a close, handing it the new head on a push and nothing on a close.
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

# A FILTER THAT MATCHES NOTHING PRINTS NOTHING, which is indistinguishable from
# a filter that is working and has nothing to do. So the one input that means
# "this script can no longer recognize the machine" is a failure rather than an
# empty line — otherwise a renamed runner label turns this into a no-op that
# reports success forever.
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
