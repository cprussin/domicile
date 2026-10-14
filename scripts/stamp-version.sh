#!/usr/bin/env bash
# Sets each manifest's `version` to commit <rev>'s, `0.0.0-alpha-<sha>`, and
# prints it. There is no semver yet. npm, the distribution packages and the
# flake ship manifests stamped by this; the tree's stay `0.0.0`.
#
#   scripts/stamp-version.sh <rev> <package.json>...
#
# - <rev>: a full commit hash, or a flake's `dirtyRev` (`<hash>-dirty`), which
#   gives a `-dirty` version.
# - `alpha-<sha>`, not `alpha.<sha>`: semver reads an all-digit identifier as
#   numeric, and one with a leading zero is not a valid version.
set -euo pipefail

[ "$#" -ge 2 ] || {
  echo "usage: stamp-version.sh <rev> <package.json>..." >&2
  exit 2
}
[[ "$1" =~ ^([0-9a-f]{40})(-dirty)?$ ]] || {
  echo "stamp-version.sh: $1 is not a full commit hash" >&2
  exit 2
}
VERSION="0.0.0-alpha-${BASH_REMATCH[1]:0:12}${BASH_REMATCH[2]}"
shift

for manifest in "$@"; do
  jq --arg version "$VERSION" '.version = $version' "$manifest" >"$manifest.next"
  mv "$manifest.next" "$manifest"
done
echo "$VERSION"
