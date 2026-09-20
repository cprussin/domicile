#!/usr/bin/env bash
# That a workflow triggers the checks rather than being where they live.
#
# This repository has three task runners already — bun, turbo and cargo — and a
# fourth, `scripts/check.sh`, that spans them because the end-to-end checks
# span the languages. None of that helps while a check's only definition is a
# `run:` block, and for a long time that is where most of them were:
# `engine.yml` alone was 1278 lines and 47 steps, 24 of them a guard invocation
# and 11 of those a control, and the only way to run the engine's guard suite
# was to read the YAML and retype it. `guard-css-and-resize.sh` said so in its
# own header: it had never been run by anything but a person.
#
# THE COST WAS NOT CONVENIENCE, IT WAS DRIFT, and it is measurable. The DRM
# suites' floors were written twice, once in `engine.yml` and once in
# `engine-drm-probe.yml`, and the two copies disagreed: `DrmScreenTest:26`
# against `DrmScreenTest:18`, and the probe's list had no `DrmEdidSerialTest`
# at all. Both were correct on the day they were written. Neither could be run
# outside CI, so nothing but CI could notice they had parted.
#
# So the rules below are about WHERE a check is defined, not what it asserts.
# A guard is named by a script under `scripts/`, a workflow names the script,
# and the floors have one home. What a workflow is still allowed to carry is
# the things that are only true of CI: the runner label, the path filter, the
# concurrency group, the tree lock, and fetching a toolchain.
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

# A workflow with its comments taken out, because a comment naming a script is
# how these files explain themselves and every rule below would read it as an
# invocation. Only whole-line comments: a `#` after code is not one of these
# files' habits, and stripping to the first `#` would cut a shell parameter
# expansion in half.
without_comments() { # workflow
  grep -v '^[[:space:]]*#' "$1"
}

# --- the guards are not invoked from YAML -----------------------------------

# What a workflow may not name. Each of these is a check's own entry point, so
# a workflow that names one is a workflow holding the definition of a check:
# the shell it needs, the wrapper it runs under, and — for a guard — whether
# this is the positive run or the control, which is the part that was only ever
# written in `env:`.
echo "no workflow holds a check's definition"

# Invocations rather than mentions. An earlier version of this matched the bare
# names and caught three things that were not offenses: the word
# `ozone_unittests` inside a `::error::` message, and — twice —
# `engine-guard-client-window.sh`, which is the *replacement*, because
# `guard-client-window.sh` is a substring of it. A rule that fails on a
# workflow for naming the script it correctly delegates to is a rule nobody
# will keep.
for pattern in \
  'packages/domicile-engine/scripts/guard-' \
  'packages/domicile-engine/scripts/spike' \
  '--gtest_' \
  '\./[a-z_]*_unittests'
do
  offenders=""
  for workflow in "$WORKFLOWS"/*.yml; do
    # `-e`, because one of these patterns starts with `--` and grep read it as
    # an option: three of the four rules here reported `ok` having run no grep
    # at all, which is the silent pass this whole file is about.
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

# The other direction, and the one a path filter cannot give you: a guard
# script added to the package and wired to nothing is a check that was written
# and never runs. `check.sh`'s groups glob rather than list for exactly this
# reason, and this is the same rule one level up.
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

# The positive, established rather than assumed: a glob that matched nothing
# reports every rule above as passing, which is how a renamed directory turns
# this half of the file into a green no-op.
if [ "$guards" -ge 10 ]; then
  ok "the guards were found at all ($guards of them)"
else
  fail "the guards were found at all" \
    "only $guards matched $GUARDS/guard-*.sh; the rules above asserted nothing"
fi

# --- the engine group's list holds every engine check ------------------------

# `check.sh` globs every other group and writes this one out, because the engine
# checks have an order worth keeping: the cheap ones first, so a run that has
# already found the symbol missing does not then spend the ten minutes of
# guards that follow photographing pixels to say so again. A glob cannot carry
# an order, and a list cannot carry completeness — so the order lives there and
# completeness lives here. Without this, a check added to `scripts/` and left
# out of the list is one that never runs, which is the failure the globs exist
# to prevent.
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

# ELEVEN OF THE THIRTEEN GUARD CHECKS HAVE A CONTROL, and
# `DOMICILE_GUARD_CONTROL=0` turns one off. That switch exists because `pinned-engine.yml` and
# `engine-release.yml` each run one guard and said in prose that a second run
# would buy nothing and spend the slot twice — and the job it must never be set
# for is the one whose controls ARE the point. A `engine.yml` that opted out
# would still be green, still run every guard, and no longer establish that
# any of them can fail. That is this repository's oldest failure mode with a new
# door, and it would not show up as a red check anywhere.
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

# THE POSITIVE, because a rule about a switch nothing uses asserts nothing: if
# the two callers that opt out stopped doing so, the rule above would pass
# forever while the switch quietly became dead code — and the ~65s it saves on
# every pull request would be back with nobody looking.
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

# A group `check.sh` knows and no workflow names is a group that runs on
# somebody's laptop and nowhere else. That is how `engine-drm-probe.yml` came
# to be the only thing running the DRM suites — a `workflow_dispatch`, so a
# test that runs after the change that broke it has already landed.
echo "every check.sh group is run by a workflow"

# `KNOWN` is the list `check.sh` validates a named group against, so it is the
# whole set of groups there are. Read from the assignment rather than from a
# copy kept here, which would drift the way the floors did.
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

# Named rather than derived, because the set is small and the interesting thing
# about a workflow joining it is that somebody decided it should. The ones left
# out are left out for a reason and each reason is written down:
#
#   engine-cancel-closed.yml  cancels stale runs; it asserts nothing.
#   engine-release.yml        builds and publishes a tarball. The guard it runs
#                             on the packaged build is a `scripts/` one, which
#                             the first rule above already forces.
#   engine-drm-probe.yml      a dispatch-only run on hardware. Same: the suites
#                             it runs are a `scripts/` one now.
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
