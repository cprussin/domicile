#!/usr/bin/env bash
# Tags the release checked out and moves `release` to it.
#
#   .github/scripts/release-tag.sh
#
# - `<package>@<version>` for each package version not tagged yet, by
#   `changeset tag`; `domicile@<version>` is the distribution packages'.
# - `release-<YYYYMMDD>-<HHMMSS>`, in UTC, for the release as a whole.
#
# Pushes the tags, then `release`, which only moves forward.
# `DOMICILE_RELEASE_DRY_RUN=1` makes the tags locally and pushes nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

git fetch -q --tags origin
before="$(git tag | sort)"
node_modules/.bin/changeset tag >/dev/null
stamp="release-$(date -u +%Y%m%d-%H%M%S)"
git tag -a "$stamp" -m "$stamp"
mapfile -t new < <(comm -13 <(echo "$before") <(git tag | sort))

printf 'tagged %s\n' "${new[@]}"
if [ "${DOMICILE_RELEASE_DRY_RUN:-}" = 1 ]; then
  echo "dry run: pushing no tags, and not moving release"
  exit 0
fi
git push -q origin "${new[@]/#/refs/tags/}"
git push -q origin HEAD:refs/heads/release
echo "release is now $(git rev-parse --short=12 HEAD)"
