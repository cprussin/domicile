#!/usr/bin/env bash
# Which changed files put a Chromium build in front of a change.
#
#   git diff --name-only A B | engine-inputs.sh inputs   the engine inputs among them
#   engine-inputs.sh gate <base> <head>                   touched= to $GITHUB_OUTPUT
#
# THIS WAS engine.yml's `paths:` FILTER, AND THE MERGE QUEUE IS WHY IT MOVED.
# GitHub applies no `paths:` to `merge_group`, and the pull request trigger
# cannot keep one either: `engine` is a required check, and a workflow a
# filter skips never reports it. So the cheap job in front of the build asks
# this instead, of what the merge group adds over its base. The patterns and
# their reasons are the filter's, unchanged; scripts/test-engine-path-filter.sh
# asserts both directions.
#
#   packages/domicile-engine/**   the pin, `patches/`, `src/`: the build itself
#   .github/workflows/engine.yml  and the scripts that are its steps, because a
#   .github/scripts/engine-*.sh   change to a step is a change to the job
#   scripts/check.sh              and what the job asserts, which lives there
#   scripts/engine-*.sh           now; named exactly, because the rest of
#   scripts/lib/engine-guard.sh   `scripts/` is checks for `ubuntu-latest`
#
# Less two exclusions, each narrower than it looks like it could be: prose
# under the package, because nothing reads it, and `engine-release.nix`,
# because the build cannot read it -- it resets the tree to `CHROMIUM_PIN` and
# applies `patches/`, and never looks at a published tarball. What proves a
# repin is nix-build.yml, which fetches exactly that url and hash on every
# change.
set -euo pipefail

usage() { echo "usage: $(basename "$0") <inputs | gate <base> <head>>" >&2; exit 2; }

# `*` stops at a `/` and `**` does not, as GitHub's filter read them.
INCLUDE='^(packages/domicile-engine/.*|\.github/workflows/engine\.yml|\.github/scripts/engine-[^/]*\.sh|scripts/check\.sh|scripts/engine-[^/]*\.sh|scripts/lib/engine-guard\.sh)$'
EXCLUDE='^(packages/domicile-engine/(.*/)?[^/]*\.md|packages/domicile-engine/engine-release\.nix)$'

# `|| true` on each grep because matching nothing is an answer here, not a
# failure: a docs change has no engine inputs.
inputs() { { grep -E "$INCLUDE" || true; } | { grep -vE "$EXCLUDE" || true; }; }

case "${1:-}" in
  inputs) inputs ;;
  gate)
    [ "$#" -eq 3 ] || usage
    : "${GITHUB_OUTPUT:?}"
    # Not piped, so a base the checkout does not have fails this step rather
    # than reading as an empty diff -- and a failed gate builds.
    changed="$(git diff --name-only "$2" "$3")"
    touched="$(printf '%s\n' "$changed" | inputs)"
    if [ -n "$touched" ]; then
      echo "touched=true" >>"$GITHUB_OUTPUT"
      echo "this change touches the engine:"
      printf '%s\n' "$touched" | sed 's/^/  /'
    else
      echo "touched=false" >>"$GITHUB_OUTPUT"
      echo "this change touches nothing the engine build reads"
    fi
    ;;
  *) usage ;;
esac
