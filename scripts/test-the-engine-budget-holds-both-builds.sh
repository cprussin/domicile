#!/usr/bin/env bash
# The engine job's budget, against the work its own steps do.
#
# `engine.yml` builds Chromium TWICE on the run that matters. `out/Domicile` is
# the component build everything above the release steps is proved against;
# `out/Release` is `is_component_build = false` in a directory of its own, and
# it is what gets packaged, published and named by `engine-release.nix`. On a
# tree that already carries the series both are incremental and the job is
# minutes. On a pin roll neither is: the reset moves the checkout onto a fresh
# upstream revision, and each output directory is compiled from nothing.
#
# `timeout-minutes: 360` did not hold that, and the way it failed is the reason
# this file exists. Run 35714578006 (job 106702924356), the pull request that
# rolled `CHROMIUM_PIN` to `86298bb`:
#
#   set up, reset, sync, apply, stamp   13:13:01 -> 13:14:56    1m55s
#   Build (out/Domicile, from scratch)  13:14:56 -> 18:22:13    5h07m
#   The engine's checks                 18:22:13 -> 18:31:13    9m
#   Build the release configuration     18:31:13 -> 19:18:35    CANCELED 47m in
#   package / guard / publish / repin                           SKIPPED
#
# Six hours and five minutes of `crux`, and nothing came out of it: no tarball,
# no release, and `engine-release.nix` never written back — which is the step
# that makes a repin pull request go green, so the branch stayed red for the
# absence of the thing the run was killed before producing. The log's last
# lines are `Terminate orphan process` for siso and a swarm of clang++, so the
# compile was killed in flight.
#
# WHAT A COLD RELEASE BUILD COSTS IS MEASURED, not guessed at. `engine-release.yml`
# runs the same `engine-release-build.sh` into the same `out/Release`, and its
# own runs after a pin moved are the number:
#
#   run 35559130923   Build   03:55:29 -> 07:41:50   3h46m
#   run 35620485558   Build   15:40:31 -> 19:05:58   3h25m
#
# So the floor below is the repin above with its canceled step replaced by the
# longer of those two, plus the package, the guard, the publish and the
# write-back that a finished run still owes:
#
#   1m55s + 5h07m + 9m + 3h46m + ~4m  =  9h09m  =  549 minutes
#
# THE FLOOR IS NOT THE BUDGET, AND MUST NOT BE READ AS ONE. It is the point
# below which a budget is refuted by a run that has already happened; how much
# headroom a budget carries over it is a judgment about a machine that also
# serves its owner's interactive builds — the same from-scratch `out/Domicile`
# has been measured at 4h16m on a quiet machine and 5h07m in CI. A test can
# assert the first and has no business asserting the second.
#
# AND THE BUDGET CANNOT DEPEND ON THE CASE. `timeout-minutes` is fixed before
# the job starts, and which case a run is in — does the checkout carry this
# series, does this series still owe a release — is decided by steps INSIDE it.
# So the one number has to hold the most expensive run this job can have, and
# the cheap run pays nothing for that: a budget is a ceiling, not a spend.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
[ -d "$WORKFLOWS" ] || { echo "no $WORKFLOWS" >&2; exit 1; }

# The measured cold repin, in minutes. See the arithmetic above -- two builds,
# from before engine.yml built only out/Release, so now a generous floor.
FLOOR=549

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A workflow's commands, with its whole-line comments taken out. Every question
# below is about what a step RUNS, and these files name their scripts in prose
# as often as they run them — this one names both builds in the header you are
# reading.
commands() { grep -v '^[[:space:]]*#' "$1"; }

# The job's `timeout-minutes` as the file writes it, empty if it writes none.
# The first match: these workflows have one job each, and a second one
# appearing is a file this rule would want to be told about rather than one it
# should quietly average.
declared() { # workflow
  commands "$1" |
    sed -n 's/^[[:space:]]*timeout-minutes:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1
}

# And the budget the job actually runs under, which is not the same question:
# GitHub applies 360 minutes to a job that declares nothing. That is the
# platform's documented number rather than this file's guess at one, and the
# rules below are about how long a run may take — so they read it, while the
# rule above reads the declaration and says so when it is missing.
budget() { # workflow
  printf '%s\n' "$(declared "$1")" | grep . || printf '360\n'
}

# --- a budget is declared, never inherited -----------------------------------

# GITHUB'S DEFAULT IS 360, WHICH IS THE NUMBER THAT BROKE. A job with no
# `timeout-minutes` gets it silently, so a crux workflow that leaves the key
# out has not chosen a small budget — it has failed to choose at all, and the
# evidence above is what that costs on a machine where a build is hours.
echo "every crux workflow says how long its job may take"

crux=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  # The machine, not the filename, for the reason test-engine-concurrency.sh
  # globs the same way: a workflow is in scope the moment it asks for that
  # runner.
  grep -q 'self-hosted, *crux' "$workflow" || continue
  crux=$((crux + 1))

  if [ -n "$(declared "$workflow")" ]; then
    ok "$name declares a budget ($(declared "$workflow")m)"
  else
    fail "$name declares a budget" \
      "it has no timeout-minutes, so GitHub gives it 360 — the number a cold repin already overran"
  fi
done

if [ "$crux" -ge 2 ]; then
  ok "the crux workflows were found at all ($crux of them)"
else
  fail "the crux workflows were found at all" \
    "only $crux matched 'self-hosted, crux'; the rule above asserted nothing"
fi

# --- building and checking costs more than building ---------------------------

# ASKED OF THE STEPS, NOT OF THE FILENAME. `engine-build-in-shell.sh` builds the
# release configuration plus everything the checks load, and the job then runs
# them; a workflow that only runs `engine-release-build.sh` does strictly less,
# and cannot be given more time.
echo "the job that builds and checks has the larger budget"

both=""
release_only=""
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  if commands "$workflow" | grep -q 'engine-build-in-shell\.sh'; then
    both="$both $name"
  elif commands "$workflow" | grep -q 'engine-release-build\.sh'; then
    release_only="$release_only $name"
  fi
done

for name in $both; do
  mine="$(budget "$WORKFLOWS/$name")"
  for other in $release_only; do
    theirs="$(budget "$WORKFLOWS/$other")"
    if [ "$mine" -ge "$theirs" ]; then
      ok "$name (${mine}m) has at least $other's budget (${theirs}m)"
    else
      fail "$name (${mine}m) has at least $other's budget (${theirs}m)" \
        "$name builds out/Release AND runs the checks and $other only builds, so the strictly larger job is the one that gets killed first"
    fi
  done

  if [ "$mine" -ge "$FLOOR" ]; then
    ok "$name's budget holds a measured cold repin (${mine}m against ${FLOOR}m)"
  else
    fail "$name's budget holds a measured cold repin (${mine}m against ${FLOOR}m)" \
      "run 35714578006 spent 5h07m on out/Domicile and 9m on the checks before the release build even started, and a cold out/Release has measured 3h46m"
  fi
done

# --- a run that waits for the compile slot still finishes -------------------

# THE WAIT COMES OUT OF THE SAME BUDGET. A run whose tree is cold waits for
# `engine-compile-slot.sh` while another run compiles, and what it waits behind
# can be a cold repin -- run 36064386536 refused after 30 minutes behind one
# that had held the slot for 2h18m. So the wait has to outlast a cold repin,
# and whatever it spent, the run still has to fit its own cold repin after it:
# a job killed mid-compile leaves a half-linked out/Release for the next run.
#
# AND THE BUDGET HAS A CEILING OF ITS OWN. The last thing a repin run does is
# push `engine-release.nix` back with GITHUB_TOKEN, which GitHub expires after
# 24 hours however long the job may run.
echo "a run that waits for the compile slot still has a cold repin's budget"

# The take step's `DOMICILE_COMPILE_SLOT_WAIT`, in seconds, or the script's
# own default when the workflow sets none.
slot_wait() { # workflow
  commands "$1" |
    sed -n 's/^[[:space:]]*DOMICILE_COMPILE_SLOT_WAIT:[[:space:]]*\([0-9][0-9]*\).*/\1/p' |
    head -1 | grep . ||
    sed -n 's/.*DOMICILE_COMPILE_SLOT_WAIT:-\([0-9][0-9]*\).*/\1/p' \
      "$ROOT/.github/scripts/engine-compile-slot.sh" | head -1
}

TOKEN_LIFETIME=1440

for name in $both; do
  mine="$(budget "$WORKFLOWS/$name")"
  waits=$(($(slot_wait "$WORKFLOWS/$name") / 60))

  if [ "$waits" -ge "$FLOOR" ]; then
    ok "$name waits out a holder's cold repin (${waits}m against ${FLOOR}m)"
  else
    fail "$name waits out a holder's cold repin (${waits}m against ${FLOOR}m)" \
      "a run behind a repin gives up before the repin can finish, and goes red for nothing but the overlap"
  fi

  if [ $((waits + FLOOR)) -le "$mine" ]; then
    ok "$name still holds a cold repin after the longest wait (${waits}m + ${FLOOR}m within ${mine}m)"
  else
    fail "$name still holds a cold repin after the longest wait (${waits}m + ${FLOOR}m within ${mine}m)" \
      "a run that waits that long is killed partway through its own compile"
  fi

  # And the latency guard's wait for a quiet machine: what it waits behind is
  # the same compile, from a run whose tree is warm and has spent minutes.
  quiet="$(commands "$WORKFLOWS/$name" |
    sed -n 's/^[[:space:]]*DOMICILE_RENDER_NODE_QUIET_WAIT:[[:space:]]*\([0-9][0-9]*\).*/\1/p' |
    head -1 | grep . ||
    sed -n 's/.*DOMICILE_RENDER_NODE_QUIET_WAIT:-\([0-9][0-9]*\).*/\1/p' \
      "$ROOT/.github/scripts/engine-render-node-lock.sh" | head -1)"
  quiet=$((quiet / 60))
  if [ "$quiet" -ge "$FLOOR" ] && [ "$quiet" -le "$mine" ]; then
    ok "$name's latency guard waits out another run's cold repin (${quiet}m against ${FLOOR}m)"
  else
    fail "$name's latency guard waits out another run's cold repin (${quiet}m against ${FLOOR}m, budget ${mine}m)" \
      "a warm run finishing beside a repin would give up and go red for nothing but the overlap"
  fi

  if [ "$mine" -le "$TOKEN_LIFETIME" ]; then
    ok "$name ends before its token does (${mine}m within ${TOKEN_LIFETIME}m)"
  else
    fail "$name ends before its token does (${mine}m within ${TOKEN_LIFETIME}m)" \
      "GITHUB_TOKEN expires after 24 hours, so a run that long cannot push engine-release.nix back"
  fi
done

# THE POSITIVES, because a split that matches nothing on one side asserts
# nothing on that side: with no both-builder the whole section above is a loop
# that never runs, and with no release-only workflow the comparison is.
if [ -n "$both" ]; then
  ok "something builds and checks (${both# })"
else
  fail "something builds and checks" \
    "no workflow runs engine-build-in-shell.sh, so the rules above asserted nothing"
fi
if [ -n "$release_only" ]; then
  ok "something builds only the release configuration (${release_only# })"
else
  fail "something builds only the release configuration" \
    "every release build is in a workflow that also proves the change, so the comparison above asserted nothing"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
