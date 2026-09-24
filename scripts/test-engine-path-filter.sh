#!/usr/bin/env bash
# Which files put a four-hour Chromium build in front of a change, asserted.
#
# `engine.yml` is the most expensive thing in this repository. It runs on
# `crux`, which has ONE job slot, and a run holds that slot from
# `actions/checkout` to the `if: always()` drop — so every run of it is time
# nothing else on that machine can have. An incremental build is ~27m in
# practice and a pin roll is four hours. Its `paths:` filter is therefore not
# housekeeping: it is the only thing standing between an unrelated commit and
# that queue.
#
# A path filter has two ways to be wrong and they fail in opposite directions:
#
#   - too wide, and a file the job cannot read costs the slot anyway. That is
#     `engine-release.nix`, which is generated, contains a commit, a url and a
#     hash, and names which published tarball `nix build .#engine` fetches.
#     `engine.yml` never reads it: it resets /build/chromium/src to
#     `CHROMIUM_PIN` and applies `patches/` over it. A repin is three lines
#     that cannot change what that build produces, and it was costing two full
#     builds — one on the pull request, one on the merge to main.
#
#   - too narrow, and a real engine source reaches main without the pixel
#     guard ever looking at it. That is the worse failure and the harder one to
#     notice, because the missing check does not go red: it does not appear.
#     This repository has shipped three checks that could not fail and is
#     sensitive about it; a filter that silently excludes `patches/` is the
#     same mistake in workflow form.
#
# So both directions are asserted here, and the exclusions are asserted to be
# EXACTLY as narrow as they claim: `packages/domicile-engine/other.nix` still
# counts, which is what distinguishes "this one generated file" from an
# `*.nix` exclusion somebody widened later.
#
# THE LIST IS A SCRIPT NOW, NOT A `paths:` BLOCK, and that is the merge queue's
# doing. `engine.yml` runs on `merge_group`, and GitHub does not apply `paths:`
# to that event at all -- so the question "does this change touch the engine"
# is asked by `.github/scripts/engine-inputs.sh` in the cheap job in front of
# the build, against the merge group's base. The `pull_request` trigger must
# not carry a filter either: `engine` is a required check, a workflow a filter
# skips never reports it, and a pull request waiting on a check that never
# reports cannot enter the queue. So the last two assertions about engine.yml
# are that it has no filter left, and that the one list lives in one place.
#
# AND THE THING THAT MAKES THE EXCLUSION SAFE IS IN ANOTHER FILE, so it is
# asserted here too. Excluding the pin from the engine build is only correct
# while something else proves a new hash actually resolves — a url under a tag
# that was deleted, or a hash off by a byte, is a flake that cannot be built
# and every open pull request goes red for a reason none of them caused.
# `nix-build.yml` is that something: it builds `.#manganese` and `.#simple`,
# which reach `domicileEngine`, which is `fetchurl` of exactly that url and
# hash. It carries no `paths:` at all, and the moment it grows one this
# exclusion stops being safe. That is the last check below.
#
# Read against the rules GitHub's filter used, which the script keeps: `*`
# stops at a `/` and `**` does not, and a later exclusion wins over the
# include it narrows. The load-bearing patterns are a literal path, a trailing
# `/**`, and a single-star basename.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
ENGINE="$WORKFLOWS/engine.yml"
NIX_BUILD="$WORKFLOWS/nix-build.yml"
INPUTS="$ROOT/.github/scripts/engine-inputs.sh"
[ -f "$ENGINE" ] || { echo "no $ENGINE" >&2; exit 1; }
[ -f "$NIX_BUILD" ] || { echo "no $NIX_BUILD" >&2; exit 1; }
[ -x "$INPUTS" ] || { echo "no $INPUTS" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A workflow's top-level `on:` block, comments and all, from `on:` to the next
# column-zero key.
on_block() { # workflow
  awk '/^on:/ { in_on = 1; next }
       in_on && /^[^[:space:]]/ { in_on = 0 }
       in_on { print }' "$1"
}

# Whether one path is an engine input, asked of the script that decides it.
included() { # path
  [ "$(printf '%s\n' "$1" | "$INPUTS" inputs)" = "$1" ]
}

# A file this repository actually has, because a guard whose subjects are
# invented reads the same whether or not the tree still looks like that. A
# rename that moves the patch series out from under the filter has to fail
# here, and it can only fail here if the path came from the tree.
real() { # path
  [ -e "$ROOT/$1" ] || {
    fail "$1 is a file this repository has" \
      "it is not in the tree, so the assertion below about it proves nothing"
    return 1
  }
  return 0
}

triggers() { # label, path
  if included "$2"; then
    ok "$1"
  else
    fail "$1" "$2 is not an engine input, so a change to it would not be built"
  fi
}

does_not_trigger() { # label, path
  if included "$2"; then
    fail "$1" "$2 is an engine input, so a change to it takes the crux slot for a build that cannot read it"
  else
    ok "$1"
  fi
}

echo "engine-inputs.sh"

# --- too wide ---------------------------------------------------------------

does_not_trigger "a repin does not build the engine" \
  packages/domicile-engine/engine-release.nix

real packages/domicile-engine/upstream/setoverridechildpaintflags.md &&
  does_not_trigger "prose under the package does not build the engine" \
    packages/domicile-engine/upstream/setoverridechildpaintflags.md

# --- too narrow -------------------------------------------------------------

# The series itself, whatever it is called today. `patches/` is what
# `apply.sh` feeds to `git am` and the only reason this job exists.
patch="$(cd "$ROOT" && ls packages/domicile-engine/patches/*.patch 2>/dev/null | head -1)"
if [ -n "$patch" ]; then
  triggers "a patch builds the engine" "$patch"
else
  fail "a patch builds the engine" "no patches under packages/domicile-engine/patches"
fi

real packages/domicile-engine/CHROMIUM_PIN &&
  triggers "the Chromium pin builds the engine" \
    packages/domicile-engine/CHROMIUM_PIN

real packages/domicile-engine/scripts/apply.sh &&
  triggers "the apply script builds the engine" \
    packages/domicile-engine/scripts/apply.sh

source_file="$(cd "$ROOT" && find packages/domicile-engine/src -name '*.cc' | head -1)"
if [ -n "$source_file" ]; then
  triggers "a fork source file builds the engine" "$source_file"
else
  fail "a fork source file builds the engine" "no .cc under packages/domicile-engine/src"
fi

real .github/workflows/engine.yml &&
  triggers "the workflow builds the engine" \
    .github/workflows/engine.yml

# The steps of this job are these scripts, so a change to one is a change to
# the job. Without them the first thing to find out would be a release.
step_script="$(cd "$ROOT" && ls .github/scripts/engine-*.sh 2>/dev/null | head -1)"
if [ -n "$step_script" ]; then
  triggers "a step script builds the engine" "$step_script"
else
  fail "a step script builds the engine" "no .github/scripts/engine-*.sh"
fi

# AND WHAT THE JOB ASSERTS, which is no longer in the workflow at all. The
# guards, the gtest floors and the artifact check are `scripts/engine-*.sh`,
# which engine is pointed at and whether each runs its control is
# `scripts/lib/engine-guard.sh`, and the order they run in and the group that
# holds them is `scripts/check.sh`. A change to any of those changes what this
# job proves, so a change to any of those has to be a change it runs on —
# otherwise the pixel suite can be edited and nothing rebuilds to try it, which
# is the "too narrow" failure in its most direct form.
engine_check="$(cd "$ROOT" && ls scripts/engine-*.sh 2>/dev/null | head -1)"
if [ -n "$engine_check" ]; then
  triggers "an engine check builds the engine" "$engine_check"
else
  fail "an engine check builds the engine" "no scripts/engine-*.sh"
fi

real scripts/lib/engine-guard.sh &&
  triggers "the guard library builds the engine" \
    scripts/lib/engine-guard.sh

real scripts/check.sh &&
  triggers "the runner builds the engine" scripts/check.sh

# And the other direction for the same directory, because `scripts/` is mostly
# checks for `ubuntu-latest` and they must never take the `crux` slot. This is
# what distinguishes the three patterns above from a `scripts/**` somebody
# widens later.
does_not_trigger "an unrelated check does not build the engine" \
  scripts/test-american-english.sh

does_not_trigger "a nix check does not build the engine" \
  scripts/nix-the-shells-build.sh

# --- exactly as narrow as it says -------------------------------------------

# Not a file in the tree, and that is the point: this asserts the SHAPE of the
# exclusion rather than its effect on today's checkout. If somebody ever writes
# `!packages/domicile-engine/**/*.nix` because it looked like the same thing,
# a second .nix file added under that package would stop being built and
# nothing would say so. Here, it fails.
triggers "the exclusion is one generated file and not every .nix" \
  packages/domicile-engine/other.nix

# Prose at the package root is prose too.
real packages/domicile-engine/README.md &&
  does_not_trigger "the package's README does not build the engine" \
    packages/domicile-engine/README.md

# A step script is a file directly under `.github/scripts`; the single star
# stops at a slash, as GitHub's did.
does_not_trigger "the step-script glob does not reach into a directory" \
  .github/scripts/engine-x/nested.sh

# And the same for prose: a `!packages/domicile-engine/**` that overshot would
# still pass every exclusion assertion above.
triggers "the exclusions did not swallow the package" \
  packages/domicile-engine/scripts/build.sh

# --- what makes excluding the pin safe --------------------------------------

echo "nix-build.yml"

# `nix build .#manganese .#simple` reaches `domicileEngine`, which is a
# `fetchurl` of the url and hash in `engine-release.nix`. It is the only check
# that resolves a repin at all, and it can only be that while it runs on
# everything: a `paths:` here — however reasonable the day somebody adds one —
# would leave a repin proved by nothing, since engine.yml no longer looks at
# it.
if on_block "$NIX_BUILD" | grep -qE '^[[:space:]]*paths(-ignore)?:'; then
  fail "nix-build.yml still runs on every change, so a repin is proved by it" \
    "it now has a paths filter, and engine.yml no longer builds on a repin — the pin would be proved by nothing"
else
  ok "nix-build.yml still runs on every change, so a repin is proved by it"
fi

# --- one list, in one place --------------------------------------------------

echo "engine.yml"

# A `paths:` left on `pull_request` is a required check that never reports on
# the pull requests it filters out, and those can never enter the queue. One
# on `merge_group` is ignored by GitHub, which is worse: it reads as a filter
# and filters nothing. Either way the list the script holds would be a second
# list, and two lists drift.
if on_block "$ENGINE" | grep -v '^[[:space:]]*#' | grep -qE '^[[:space:]]*paths(-ignore)?:'; then
  fail "engine.yml filters by the script alone" \
    "its on: block still carries a paths filter"
else
  ok "engine.yml filters by the script alone"
fi

# --- the gate asks it of the merge group's own change ------------------------

# What a merge group adds over its base, which is what the queue is about to
# merge -- including whatever is queued ahead of it, since its head carries
# that too. A real repository, because the question is a diff between two
# commits and a fake `git` would be a guard against itself.
echo "engine-inputs.sh gate"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q "$WORK/repo"
mkdir -p "$WORK/repo/packages/domicile-engine/patches" "$WORK/repo/docs"
echo pin >"$WORK/repo/packages/domicile-engine/CHROMIUM_PIN"
echo doc >"$WORK/repo/docs/README.md"
git -C "$WORK/repo" add -A && git -C "$WORK/repo" commit -qm base
base="$(git -C "$WORK/repo" rev-parse HEAD)"

gate() { # base, head
  : >"$WORK/out"
  (cd "$WORK/repo" && GITHUB_OUTPUT="$WORK/out" "$INPUTS" gate "$1" "$2" >/dev/null 2>&1)
  local rc=$?
  [ "$rc" -eq 0 ] || { echo "exit $rc"; return; }
  grep '^touched=' "$WORK/out" | cut -d= -f2
}

echo more >>"$WORK/repo/docs/README.md"
git -C "$WORK/repo" commit -qam docs
docs="$(git -C "$WORK/repo" rev-parse HEAD)"
if [ "$(gate "$base" "$docs")" = false ]; then
  ok "a merge group that leaves the engine alone does not build it"
else
  fail "a merge group that leaves the engine alone does not build it" \
    "a docs change answered '$(gate "$base" "$docs")', which puts it in the crux queue"
fi

echo new >"$WORK/repo/packages/domicile-engine/patches/0001-x.patch"
git -C "$WORK/repo" add -A && git -C "$WORK/repo" commit -qm patch
if [ "$(gate "$base" HEAD)" = true ]; then
  ok "a merge group that touches the series builds it"
else
  fail "a merge group that touches the series builds it" \
    "a new patch answered '$(gate "$base" HEAD)', so the queue would merge it unbuilt"
fi

# A base the checkout does not have is not "nothing changed". The job in
# front of the build must fail, and engine.yml then builds rather than skips.
if [ "$(gate 0000000000000000000000000000000000000000 HEAD)" != false ] &&
   [ "$(gate 0000000000000000000000000000000000000000 HEAD)" != true ]; then
  ok "a base it cannot read is an error, not an answer"
else
  fail "a base it cannot read is an error, not an answer" \
    "it answered '$(gate 0000000000000000000000000000000000000000 HEAD)'"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
