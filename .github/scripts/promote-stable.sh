#!/usr/bin/env bash
# Move `stable` to the commit checked out, if it runs the official engine.
#
#   .github/scripts/promote-stable.sh
#
# `stable` is what somebody runs to get the production engine without a hash:
# `nix run github:cprussin/domicile/stable#manganese`. Main runs the CHECKED
# engine (DCHECKs on, no PGO) from a merge that moves the fork until the
# nightly official build of that series is pinned (engine-release.yml), so
# main alone cannot promise that. This commit can be stable when its official
# pin is of its checked pin's series -- exactly when engine-pin.nix picks the
# official engine.
#
# ONLY FORWARD. Stable is pushed without force, so it only ever moves along
# main. A run behind a newer one, whose commit stable already has, does
# nothing; a stable that is not an ancestor of this commit is refused rather
# than overwritten, because somebody put it there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CHECKED=packages/domicile-engine/engine-release.nix
OFFICIAL=packages/domicile-engine/engine-official.nix

identity_of() { sed -n 's/^ *identity = "\([0-9a-f]*\)";.*/\1/p' "$1" | head -1; }

head="$(git rev-parse HEAD)"
checked="$(identity_of "$CHECKED")"
official="$(identity_of "$OFFICIAL")"
if [ "$checked" != "$official" ]; then
  echo "${head:0:12} runs the checked engine of series ${checked:0:12}; the official build is of series ${official:0:12}, so stable stays"
  exit 0
fi

# `--exit-code` answers 2 for no such ref, the first run's case; any other
# failure is the job's.
status=0
git ls-remote -q --exit-code origin refs/heads/stable >/dev/null || status=$?
case "$status" in
  (0) ;;
  (2) echo "there is no stable yet" ;;
  (*) exit "$status" ;;
esac
if [ "$status" = 0 ]; then
  git fetch -q origin +refs/heads/stable:refs/remotes/origin/stable
  stable="$(git rev-parse refs/remotes/origin/stable)"
  if git merge-base --is-ancestor "$head" "$stable"; then
    echo "stable (${stable:0:12}) already has ${head:0:12}"
    exit 0
  fi
  if ! git merge-base --is-ancestor "$stable" "$head"; then
    echo "stable (${stable:0:12}) is not an ancestor of ${head:0:12}; not overwriting it" >&2
    exit 1
  fi
fi

git push -q origin "$head:refs/heads/stable"
echo "stable is now ${head:0:12}, official engine series ${official:0:12}"
