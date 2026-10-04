#!/usr/bin/env bash
# Checks that workflows call checks defined under `scripts/` instead of
# defining them in `run:` blocks.
#
# A check defined only in YAML cannot run outside CI, so copies of it drift
# unnoticed. Workflows may still carry what is specific to CI: the runner
# label, path filter, concurrency group, tree lock and toolchain fetch.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
CHECK="$ROOT/scripts/check.sh"
GUARDS="$ROOT/packages/domicile-engine/scripts"
[ -d "$WORKFLOWS" ] || { echo "no $WORKFLOWS" >&2; exit 1; }
[ -f "$CHECK" ] || { echo "no $CHECK" >&2; exit 1; }
[ -d "$GUARDS" ] || { echo "no $GUARDS" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Prints a workflow without whole-line comments, so a comment that names a
# script is not read as an invocation. Trailing comments stay: stripping from
# the first `#` would cut a `${var#...}` expansion.
without_comments() { # workflow
  grep -v '^[[:space:]]*#' "$1"
}

# --- the guards are not invoked from YAML -----------------------------------

# A workflow must not name a check's entry point. Doing so puts the check's
# definition (its shell, wrapper, and for a guard whether this is the control
# run) in YAML.
echo "no workflow holds a check's definition"

# Patterns match invocations, not bare names: `engine-guard-client-window.sh`
# contains `guard-client-window.sh`, and an error message may mention
# `ozone_unittests`.
for pattern in \
  'packages/domicile-engine/scripts/guard-' \
  'packages/domicile-engine/scripts/spike' \
  '--gtest_' \
  '\./[a-z_]*_unittests'
do
  offenders=""
  for workflow in "$WORKFLOWS"/*.yml; do
    # `-e` because one pattern starts with `--`, which grep would read as an
    # option and then match nothing.
    without_comments "$workflow" | grep -qE -e "$pattern" &&
      offenders="$offenders $(basename "$workflow")"
  done
  if [ -z "$offenders" ]; then
    ok "no workflow names a $pattern"
  else
    fail "no workflow names a $pattern" \
      "named by:$offenders — that check's definition lives in YAML, so it cannot be run outside CI"
  fi
done

# --- every guard is reachable from a script ---------------------------------

# Every guard script must be run by some `scripts/engine-*.sh`; otherwise it
# never runs.
echo "every guard is run by something"

guards=0
for guard in "$GUARDS"/guard-*.sh; do
  [ -e "$guard" ] || continue
  guards=$((guards + 1))
  name="$(basename "$guard")"
  if grep -qlF "$name" "$ROOT"/scripts/engine-*.sh 2>/dev/null; then
    ok "$name is run by a scripts/engine-*.sh"
  else
    fail "$name is run by a scripts/engine-*.sh" \
      "nothing under scripts/ names it, so it runs nowhere"
  fi
done

# Require that guards were found, so an empty glob cannot pass every rule.
if [ "$guards" -ge 10 ]; then
  ok "the guards were found at all ($guards of them)"
else
  fail "the guards were found at all" \
    "only $guards matched $GUARDS/guard-*.sh; the rules above asserted nothing"
fi

# --- the engine group's list holds every engine check ------------------------

# `check.sh` lists the engine group's scripts in order (cheap checks first)
# instead of globbing them. This rule ensures the list stays complete.
echo "the engine group runs every engine check"

engine_checks=0
for script in "$ROOT"/scripts/engine-*.sh; do
  [ -e "$script" ] || continue
  engine_checks=$((engine_checks + 1))
  name="$(basename "$script")"
  if grep -qF "scripts/$name" "$CHECK"; then
    ok "$name is in the engine group"
  else
    fail "$name is in the engine group" \
      "check.sh's engine list does not name it, so it never runs"
  fi
done

if [ "$engine_checks" -ge 12 ]; then
  ok "the engine checks were found at all ($engine_checks of them)"
else
  fail "the engine checks were found at all" \
    "only $engine_checks matched scripts/engine-*.sh; the rules above asserted nothing"
fi

# --- the group itself never opts out of its controls -------------------------

# `DOMICILE_GUARD_CONTROL=0` skips a guard's control run. `pinned-engine.yml`
# and `engine-release.yml` set it to save CI time. The engine jobs must not:
# without controls they stay green but no longer show that a guard can fail.
echo "the engine job keeps its controls"

for name in engine engine-drm-probe; do
  workflow="$WORKFLOWS/$name.yml"
  [ -f "$workflow" ] || continue
  if without_comments "$workflow" | grep -q 'DOMICILE_GUARD_CONTROL'; then
    fail "$name.yml does not opt out of the controls" \
      "it sets DOMICILE_GUARD_CONTROL, which turns off the run that shows a guard can fail"
  else
    ok "$name.yml does not opt out of the controls"
  fi
done

# Require that some workflow does opt out, so the rule above has a subject and
# the switch is not dead code.
optouts=0
for workflow in "$WORKFLOWS"/*.yml; do
  without_comments "$workflow" | grep -q 'DOMICILE_GUARD_CONTROL=0' &&
    optouts=$((optouts + 1))
done
if [ "$optouts" -ge 1 ]; then
  ok "something does opt out, so the switch is live ($optouts)"
else
  fail "something does opt out, so the switch is live" \
    "no workflow sets DOMICILE_GUARD_CONTROL=0, so the rule above has no subject"
fi

# --- every group is run by a workflow ---------------------------------------

# Every `check.sh` group must be run by a workflow, or it runs only by hand.
echo "every check.sh group is run by a workflow"

# `KNOWN` in `check.sh` lists every group. Read it from there so this script
# holds no copy that can drift.
known="$(sed -n 's/^KNOWN=(\(.*\))$/\1/p' "$CHECK")"
if [ -z "$known" ]; then
  fail "check.sh's groups were read at all" \
    "no KNOWN=(...) assignment in $CHECK; the rules below asserted nothing"
else
  ok "check.sh's groups were read at all ($known)"
  for group in $known; do
    if grep -qE "check\.sh[^|;&]*[[:space:]]$group([[:space:]]|$)" \
         "$WORKFLOWS"/*.yml; then
      ok "the $group group is run by a workflow"
    else
      fail "the $group group is run by a workflow" \
        "no workflow names \`check.sh ... $group\`, so it runs only by hand"
    fi
  done
fi

# --- the workflows that check, check through scripts/ -----------------------

# Workflows that check things must do so through `scripts/`. The list is
# explicit. Excluded:
#
#   engine-cancel-stale.yml   cancels stale runs; asserts nothing.
#   engine-release.yml        builds and publishes a tarball; its guard runs
#                             from `scripts/`, which the first rule enforces.
#   engine-drm-probe.yml      dispatch-only hardware run; its suites run from
#                             `scripts/`.
echo "the checking workflows check through scripts/"

for name in cargo-test turbo-test e2e nix-build engine pinned-engine; do
  workflow="$WORKFLOWS/$name.yml"
  if [ ! -f "$workflow" ]; then
    fail "$name.yml exists" "it does not, so nothing below was asserted about it"
    continue
  fi
  if without_comments "$workflow" | grep -qE '(\./)?scripts/[a-z][a-z0-9-]*\.sh'; then
    ok "$name.yml reaches its checks through scripts/"
  else
    fail "$name.yml reaches its checks through scripts/" \
      "it names nothing under scripts/, so whatever it checks is defined in YAML"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
