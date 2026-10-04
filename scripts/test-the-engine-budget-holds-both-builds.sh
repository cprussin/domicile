#!/usr/bin/env bash
# Tests the engine job's `timeout-minutes` against the work its steps do.
#
# On a pin roll the checkout moves to a fresh upstream revision and the engine
# compiles from scratch, which takes hours. A job killed mid-compile publishes
# nothing and never writes `engine-release.nix` back, so the repin pull request
# stays red.
#
# The floor comes from measured runs. Run 35714578006 (a repin to `86298bb`)
# took 1m55s to set up, 5h07m for a cold `out/Domicile`, 9m of checks, and was
# canceled at 360 minutes during the release build. Cold `out/Release` builds
# in `engine-release.yml` took 3h46m (run 35559130923) and 3h25m
# (run 35620485558). Adding the longer one and ~4m for packaging:
#
#   1m55s + 5h07m + 9m + 3h46m + ~4m  =  9h09m  =  549 minutes
#
# The floor is a lower bound, not the budget. Headroom above it is a judgment
# about a machine that also runs its owner's builds, which a test cannot check.
#
# `timeout-minutes` is fixed before the job starts, while steps inside it
# decide whether a run is cheap or cold. So one budget must hold the most
# expensive run; a cheap run does not spend it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
[ -d "$WORKFLOWS" ] || { echo "no $WORKFLOWS" >&2; exit 1; }

# The measured cold repin, in minutes; see above. It includes both a cold
# out/Domicile and a cold out/Release, so it is above what the job costs if it
# builds only out/Release.
FLOOR=549

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A workflow with whole-line comments removed. The checks below are about what
# steps run, and these files also name scripts in comments.
commands() { grep -v '^[[:space:]]*#' "$1"; }

# The compiling job's declared `timeout-minutes`, or empty. Takes the largest,
# because engine.yml also has a short `plan` job on crux.
declared() { # workflow
  commands "$1" |
    sed -n 's/^[[:space:]]*timeout-minutes:[[:space:]]*\([0-9][0-9]*\).*/\1/p' |
    sort -n | tail -1
}

# The budget the job runs under: the declared one, or GitHub's documented
# default of 360 minutes.
budget() { # workflow
  printf '%s\n' "$(declared "$1")" | grep . || printf '360\n'
}

# --- a budget is declared, never inherited -----------------------------------

# A job without `timeout-minutes` gets GitHub's 360 silently, which a cold
# repin overruns.
echo "every crux workflow says how long its job may take"

crux=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
# Selected by runner, not filename, as test-engine-concurrency.sh does.
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

# Selected by the steps, not the filename. `engine-build-in-shell.sh` builds
# the release configuration plus what the checks load, then runs the checks. A
# workflow that only runs `engine-release-build.sh` does less, so it must not
# get more time.
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

# Waiting for `engine-compile-slot.sh` uses the same budget. A cold run may
# wait behind another run's cold repin (run 36064386536 gave up after 30
# minutes behind a 2h18m hold). So the wait must outlast a cold repin, and the
# run must still fit its own cold repin after waiting.
#
# The budget also has a ceiling: the run ends by pushing `engine-release.nix`
# with GITHUB_TOKEN, which expires after 24 hours.
echo "a run that waits for the compile slot still has a cold repin's budget"

# The take step's `DOMICILE_COMPILE_SLOT_WAIT` in seconds, or the script's
# default when the workflow sets none.
slot_wait() { # workflow
  commands "$1" |
    sed -n 's/^[[:space:]]*DOMICILE_COMPILE_SLOT_WAIT:[[:space:]]*\([0-9][0-9]*\).*/\1/p' |
    head -1 | grep . ||
    sed -n 's/.*DOMICILE_COMPILE_SLOT_WAIT:-\([0-9][0-9]*\).*/\1/p' \
      "$ROOT/.github/scripts/engine-compile-slot.sh" | head -1
}

# The wait for a tree, which `engine-tree-pool.sh pick` spends when every tree
# is held. It uses the same budget.
tree_wait() { # workflow
  commands "$1" |
    sed -n 's/^[[:space:]]*DOMICILE_TREE_WAIT:[[:space:]]*\([0-9][0-9]*\).*/\1/p' |
    head -1 | grep . ||
    sed -n 's/.*DOMICILE_TREE_WAIT:-\([0-9][0-9]*\).*/\1/p' \
      "$ROOT/.github/scripts/engine-tree-pool.sh" | head -1
}

TOKEN_LIFETIME=1440

for name in $both; do
  mine="$(budget "$WORKFLOWS/$name")"
  waits=$(($(slot_wait "$WORKFLOWS/$name") / 60))
  trees=$(($(tree_wait "$WORKFLOWS/$name") / 60))

  if [ "$waits" -ge "$FLOOR" ]; then
    ok "$name waits out a holder's cold repin (${waits}m against ${FLOOR}m)"
  else
    fail "$name waits out a holder's cold repin (${waits}m against ${FLOOR}m)" \
      "a run behind a repin gives up before the repin can finish, and goes red for nothing but the overlap"
  fi

  if [ $((trees + waits + FLOOR)) -le "$mine" ]; then
    ok "$name still holds a cold repin after the longest waits (${trees}m + ${waits}m + ${FLOOR}m within ${mine}m)"
  else
    fail "$name still holds a cold repin after the longest waits (${trees}m + ${waits}m + ${FLOOR}m within ${mine}m)" \
      "a run that waits that long is killed partway through its own compile"
  fi

  # The latency guard waits for a quiet machine, which may mean waiting out
  # another run's cold compile.
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

# Each side must match something, or the loops above assert nothing.
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
