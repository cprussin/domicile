#!/usr/bin/env bash
# Publish the distribution packages `distro/build.sh` made as GitHub releases.
#
#   GH_TOKEN=... .github/scripts/distro-packages-publish.sh <packages>
#
# Runs on the commit stable.yml just promoted. Two releases, neither marked
# latest, which the engine's series releases take:
#
#   packages-<commit>   the packages as built; a rerun uploads them again
#   packages-latest     the newest commit's packages under names without the
#                       version, so docs/RUNNING-A-DESKTOP.md#other-distributions
#                       links each one
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
LATEST=packages-latest
INSTALL="https://github.com/$GITHUB_REPOSITORY/blob/$head/docs/RUNNING-A-DESKTOP.md#other-distributions"

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release $TAG exists; uploading its assets again"
  gh release upload "$TAG" --clobber "$PACKAGES"/*
else
  NOTES="$(cat <<NOTES
Domicile for Debian, Ubuntu, Fedora, openSUSE and Arch, built from \`$head\`
with the official engine (series \`${official:0:12}\`).

Debian 12 and Ubuntu 22.04: \`domicile_*.noapparmor.deb\`. Debian 13+ and
Ubuntu 24.04+: \`domicile_*_amd64.deb\`.

Install and set up: [Other distributions]($INSTALL).
NOTES
  )"
  gh release create "$TAG" --target "$head" --title "Domicile packages ${head:0:12}" \
    --notes "$NOTES" --latest=false "$PACKAGES"/*
  echo "published $TAG"
fi

# The one package in <packages> matching a glob.
one() { # glob
  local matches=("$PACKAGES"/$1)
  [ "${#matches[@]}" -eq 1 ] && [ -e "${matches[0]}" ] || {
    echo "expected one $1 in $PACKAGES, found: ${matches[*]}" >&2
    exit 1
  }
  echo "${matches[0]}"
}

STABLE="$(mktemp -d)"
trap 'rm -rf "$STABLE"' EXIT
cp "$(one 'domicile_*_amd64.deb')" "$STABLE/domicile_amd64.deb"
cp "$(one 'domicile_*_amd64.noapparmor.deb')" "$STABLE/domicile_amd64.noapparmor.deb"
cp "$(one 'domicile-*-1.fedora.x86_64.rpm')" "$STABLE/domicile-fedora.x86_64.rpm"
cp "$(one 'domicile-*-1.opensuse.x86_64.rpm')" "$STABLE/domicile-opensuse.x86_64.rpm"
cp "$(one 'domicile-*-1-x86_64.pkg.tar.zst')" "$STABLE/domicile-x86_64.pkg.tar.zst"
NAMES=(domicile_amd64.deb domicile_amd64.noapparmor.deb domicile-fedora.x86_64.rpm
  domicile-opensuse.x86_64.rpm domicile-x86_64.pkg.tar.zst)
(cd "$STABLE" && sha256sum "${NAMES[@]}" >SHA256SUMS)
# SHA256SUMS last, so it never lists a package that is not uploaded yet.
ASSETS=("${NAMES[@]/#/$STABLE/}" "$STABLE/SHA256SUMS")

LATEST_NOTES="$(cat <<NOTES
The newest Domicile packages, under names that stay the same from release to
release. These are the packages of [$TAG](https://github.com/$GITHUB_REPOSITORY/releases/tag/$TAG),
built from \`$head\`.

Install and set up: [Other distributions]($INSTALL).
NOTES
)"

if ! gh release view "$LATEST" >/dev/null 2>&1; then
  gh release create "$LATEST" --target "$head" --title "Domicile packages (latest)" \
    --notes "$LATEST_NOTES" --latest=false "${ASSETS[@]}"
  echo "published $LATEST"
  exit 0
fi

# Only forward: a rerun for an older promotion must not replace a newer one.
mirrored="$(gh api "repos/$GITHUB_REPOSITORY/commits/$LATEST" --jq .sha)"
status="$(gh api "repos/$GITHUB_REPOSITORY/compare/$mirrored...$head" --jq .status)"
case "$status" in
  (ahead | identical) ;;
  (behind)
    echo "$head is older than ${mirrored:0:12}, which $LATEST has; leaving it"
    exit 0
    ;;
  (*)
    echo "$head and ${mirrored:0:12}, which $LATEST has, are $status; stable only moves forward" >&2
    exit 1
    ;;
esac

# Same names, so each is replaced in place and the set stays whole.
gh release upload "$LATEST" --clobber "${ASSETS[@]}"
gh release view "$LATEST" --json assets --jq '.assets[].name' | while read -r asset; do
  case " ${NAMES[*]} SHA256SUMS " in
    (*" $asset "*) ;;
    (*) gh release delete-asset "$LATEST" "$asset" --yes ;;
  esac
done
gh release edit "$LATEST" --notes "$LATEST_NOTES"
gh api --method PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/$LATEST" \
  -f sha="$head" -F force=true >/dev/null
echo "moved $LATEST to $TAG"
