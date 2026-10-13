#!/usr/bin/env bash
# Publish the distribution packages `distro/build.sh` made as a GitHub release.
#
#   GH_TOKEN=... .github/scripts/distro-packages-publish.sh <packages>
#
# Runs on the commit stable.yml just promoted. The release is tagged
# `packages-<commit>`; for one that exists already, a rerun uploads the assets
# again. Not marked latest, which the engine's series releases take; users find
# the newest by its `packages-` prefix
# (docs/RUNNING-A-DESKTOP.md#other-distributions).
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: distro-packages-publish.sh <packages>" >&2
  exit 2
}
PACKAGES="$1"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Stable runs the official engine; promote-stable.sh checks the same way.
identity_of() { sed -n 's/^ *identity = "\([0-9a-f]*\)";.*/\1/p' "$1" | head -1; }
checked="$(identity_of packages/domicile-engine/engine-release.nix)"
official="$(identity_of packages/domicile-engine/engine-official.nix)"
[ "$checked" = "$official" ] || {
  echo "this commit runs the checked engine (series ${checked:0:12}), so its packages are not published" >&2
  exit 1
}

head="$(git rev-parse HEAD)"
TAG="packages-${head:0:12}"

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release $TAG exists; uploading its assets again"
  gh release upload "$TAG" --clobber "$PACKAGES"/*
  exit 0
fi

NOTES="$(cat <<NOTES
Domicile for Debian, Ubuntu, Fedora, openSUSE and Arch, built from \`$head\`
with the official engine (series \`${official:0:12}\`).

Debian 12 and Ubuntu 22.04: \`domicile_*.noapparmor.deb\`. Debian 13+ and
Ubuntu 24.04+: \`domicile_*_amd64.deb\`.

Install and set up: [Other distributions](https://github.com/$GITHUB_REPOSITORY/blob/$head/docs/RUNNING-A-DESKTOP.md#other-distributions).
NOTES
)"
gh release create "$TAG" --target "$head" --title "Domicile packages ${head:0:12}" \
  --notes "$NOTES" --latest=false "$PACKAGES"/*
echo "published $TAG"
