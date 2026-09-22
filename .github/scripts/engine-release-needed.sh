#!/usr/bin/env bash
# What this run still owes the engine release, decided once and written to
# $GITHUB_OUTPUT.
#
#   .github/scripts/engine-release-needed.sh
#
#   build=true|false     the release configuration has to be compiled
#   write=true|false     engine-release.nix has to be regenerated and pushed
#   tag=engine-sXXXXXXX  the release this series belongs under
#   identity=<sha256>    the series, in full
#
# AN ENGINE CHANGE IS ONE PULL REQUEST, AND THIS IS THE STEP THAT MAKES IT ONE.
#
# It was two. `engine.yml` proved a change on the pull request and on the
# merge; a release was a separate workflow somebody dispatched by hand; and
# `engine-release.nix` then had to move onto the tarball that produced, which
# was a second pull request. Four engine builds and a manual step for one
# change — and the manual step is the one that got skipped, so changes that
# needed a release shipped without one and the repository described an engine
# it did not ship.
#
# WHY IT COULD NOT BE ONE BEFORE, precisely: `engine-release.nix` holds a url
# and a hash. The url named the DOMICILE COMMIT, which does not exist until
# the branch merges. The hash is of the tarball, and Chromium does not build
# byte-for-byte twice, so it cannot be predicted from the source at all.
#
# The first half is fixed by naming releases after the SERIES instead — the
# pin, `patches/` and `src/` hashed by content, which is computable from the
# branch and identical to what the merge would produce. The second half is not
# fixable and does not need to be: the build happens in the pull request, and
# the hash is written back to the branch. See engine-release-publish.sh.
#
# THE TWO WAYS TO BE WRONG HERE ARE NOT THE SAME SIZE. Saying `build=true`
# when nothing needed building is four hours of `crux` on a pull request that
# changed a comment. Saying `build=false` when the fork moved is a repository
# that describes one engine and ships another, which is #411 and is caught
# afterwards by scripts/test-the-pinned-engine-is-this-series.sh — so this
# script is allowed to be cautious about the second and must not be careless
# about the first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IDENTITY="$("$ROOT/.github/scripts/engine-series-stamp.sh" identity)"
TAG="engine-s${IDENTITY:0:12}"

say() { [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s\n' "$1" >>"$GITHUB_OUTPUT"; }
say "identity=$IDENTITY"
say "tag=$TAG"

# ASKED OF THE CHECK RATHER THAN RE-IMPLEMENTED. Whether this checkout's
# pinned engine is this checkout's series is exactly what
# scripts/test-the-pinned-engine-is-this-series.sh decides, and it is the
# thing a pull request goes red on. Two answers to one question is two answers
# that can differ, and the shape of that difference is a green check beside a
# job that decided there was nothing to do.
if "$ROOT/scripts/test-the-pinned-engine-is-this-series.sh" >/dev/null 2>&1; then
  echo "engine-release.nix already names this series ($TAG); nothing to build and nothing to write"
  say "build=false"
  say "write=false"
  exit 0
fi

say "write=true"

# IS THE TARBALL ALREADY THERE. A re-run of this job, a force-push that left
# the series alone, or a branch rebased onto one that had already built it —
# in every case the release exists and is the right one.
#
# REBUILDING IT WOULD BE WORSE THAN WASTEFUL. Chromium does not build
# byte-for-byte twice, so a second build of the same series produces a
# different tarball with a different hash; the publisher leaves an existing
# immutable release alone (deliberately — something may be pinned to it), so
# the new bytes would not even be what the url serves. Four hours to produce
# an artifact nothing would use.
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_TOKEN:?a token is needed to ask whether this series is published}"
if curl -sS -f -o /dev/null \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     -H "X-GitHub-Api-Version: 2022-11-28" \
     "https://api.github.com/repos/$GITHUB_REPOSITORY/releases/tags/$TAG"; then
  echo "$TAG is already published; this run only has to write engine-release.nix onto it"
  say "build=false"
  exit 0
fi

echo "$TAG is not published; this run builds the release configuration and publishes it"
say "build=true"
