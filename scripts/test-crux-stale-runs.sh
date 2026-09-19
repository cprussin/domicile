#!/usr/bin/env bash
# Which runs a closed pull request leaves behind, and which of them may be
# canceled.
#
# `crux` has one job slot and an engine run holds it for half an hour. GitHub
# dispatches a queued run whether or not the pull request that created it still
# exists, so a merged branch's run still builds — on 2026-09-19 two of them did,
# for #460 and #461, both merged hours earlier, while three open pull requests
# waited behind them. That is an hour of the only machine that can build the
# fork, spent on answers nobody can act on.
#
# THE DANGEROUS HALF IS THE ONE THAT MUST NOT BE CANCELED. A killed `autoninja`
# leaves a half-linked out/Domicile that the next run inherits, and the failure
# it produces reads as a code error rather than an interrupted build — which is
# why every crux workflow carries `cancel-in-progress: false` and why
# `test-engine-concurrency.sh` asserts it. A run that has STARTED is therefore
# off limits no matter whose it was. What this cancels is only runs that never
# started: `queued` (waiting for the runner) and `pending` (held by a
# concurrency group).
#
# So the filter has two jobs and this asserts both: take every stale run that
# is only waiting, and leave everything else alone.
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

run() { # id, status, branch, workflow path
  printf '{"id":%s,"status":"%s","head_branch":"%s","path":"%s"}' "$1" "$2" "$3" "$4"
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

# THE ASSERTION THIS FILE EXISTS FOR. Canceling this is a half-linked
# out/Domicile for whoever runs next, and it is the exact failure
# `cancel-in-progress: false` is set to avoid.
building="$(run 103 in_progress "$BRANCH" "$CRUX_WORKFLOW")"
expect "a run that has STARTED is never canceled, whosever branch it is" "" \
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
