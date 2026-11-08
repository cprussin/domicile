#!/usr/bin/env bash
# Puts `site`, the branch Vercel deploys domicile-desktop.com from, at
# `release` plus the main commits picked onto it.
#
#   .github/scripts/site-sync.sh [<commit>...]
#
# - Each <commit> must be on main. One `release` has already is skipped.
# - The picks on `site` that `release` doesn't have yet are picked again onto
#   it, so a release never takes back a site fix it doesn't carry.
# - A commit on `site` that is no pick is refused, since someone put it there.
#
# Picks with `cherry-pick -x`, whose line names the main commit. Pushes with a
# lease, and only when `site` changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

git fetch -q origin +refs/heads/main:refs/remotes/origin/main \
  +refs/heads/release:refs/remotes/origin/release
release="$(git rev-parse refs/remotes/origin/release)"

# `--exit-code` answers 2 for no such ref, the first run's case.
status=0
git ls-remote -q --exit-code origin refs/heads/site >/dev/null || status=$?
case "$status" in
  (0) git fetch -q origin +refs/heads/site:refs/remotes/origin/site
      site="$(git rev-parse refs/remotes/origin/site)" ;;
  (2) site="" ;;
  (*) exit "$status" ;;
esac

picked_from() { git log -1 --format=%B "$1" | sed -n 's/^(cherry picked from commit \([0-9a-f]\{40\}\))$/\1/p' | tail -1; }
released() { git merge-base --is-ancestor "$1" "$release"; }

picks=()
changed=""
if [ -n "$site" ]; then
  while read -r commit; do
    from="$(picked_from "$commit")"
    if [ -z "$from" ]; then
      echo "site has ${commit:0:12}, which was not picked from main; not overwriting it" >&2
      exit 1
    fi
    if released "$from"; then
      echo "release has ${from:0:12} now"
      changed=1
    else
      picks+=("$from")
    fi
  done < <(git rev-list --reverse "$(git merge-base "$site" "$release")..$site")
  git merge-base --is-ancestor "$release" "$site" || changed=1
else
  changed=1
fi

for arg in "$@"; do
  commit="$(git rev-parse --verify "$arg^{commit}")"
  if ! git merge-base --is-ancestor "$commit" refs/remotes/origin/main; then
    echo "${commit:0:12} is not on main" >&2
    exit 1
  fi
  if released "$commit"; then
    echo "release has ${commit:0:12} already"
  elif [[ " ${picks[*]} " == *" $commit "* ]]; then
    echo "site has ${commit:0:12} already"
  else
    picks+=("$commit")
    changed=1
  fi
done

if [ -z "$changed" ]; then
  echo "site (${site:0:12}) is up to date"
  exit 0
fi

git checkout -q --detach "$release"
for commit in "${picks[@]}"; do
  git cherry-pick -x "$commit" >/dev/null
  echo "picked ${commit:0:12}: $(git log -1 --format=%s "$commit")"
done
git push -q --force-with-lease="refs/heads/site:$site" origin HEAD:refs/heads/site
echo "site is now $(git rev-parse --short=12 HEAD): release ${release:0:12} and ${#picks[@]} pick(s)"
