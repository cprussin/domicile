#!/usr/bin/env bash
# Publish every public `@domicile/*` package to npm, as an alpha of this commit:
# `0.0.0-alpha-<sha>` under the `alpha` dist-tag. No semver yet; a version
# names the commit it was built from.
#
# `bun pm pack` rather than `npm pack`, because bun is what rewrites
# `workspace:*` and `catalog:` to real ranges; `npm publish` of the tarball
# rather than `bun publish`, because npm is what speaks trusted publishing
# (GitHub's OIDC token, no secret) and attaches provenance.
#
# `alpha-<sha>`, not `alpha.<sha>`: a dot-separated identifier of digits alone
# is numeric to semver, and a short sha that happens to be all digits with a
# leading zero is then not a version at all.
#
# DOMICILE_PUBLISH_DRY_RUN=<dir> packs into <dir> and publishes nothing — what
# scripts/test-publish-packages.sh runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Dependencies first, so a package is never on npm before what it needs.
PACKAGES=(chrome-sdk component-library shell-manganese)
VERSION="0.0.0-alpha-$(git rev-parse --short=12 HEAD)"
OUT="${DOMICILE_PUBLISH_DRY_RUN:-$(mktemp -d)}"

# The versions are written into the manifests to be packed and put back after,
# whatever happens: a dry run is run from a working copy.
SAVED="$(mktemp -d)"
restore() {
  for package in "${PACKAGES[@]}"; do
    cp "$SAVED/$package.json" "packages/$package/package.json"
  done
  rm -rf "$SAVED"
}
for package in "${PACKAGES[@]}"; do
  cp "packages/$package/package.json" "$SAVED/$package.json"
done
trap restore EXIT

for package in "${PACKAGES[@]}"; do
  manifest="packages/$package/package.json"
  jq --arg version "$VERSION" '.version = $version' "$manifest" >"$manifest.next"
  mv "$manifest.next" "$manifest"
done

# What the tarballs hold that git does not: the SDK's `dist/` and the Panda
# `styled-system/` the other two import.
bun run turbo run prepare build \
  --filter @domicile/sdk --filter @domicile/component-library --filter @domicile/manganese

for package in "${PACKAGES[@]}"; do
  (cd "packages/$package" && bun pm pack --quiet --ignore-scripts --destination "$OUT")
done

if [ -n "${DOMICILE_PUBLISH_DRY_RUN:-}" ]; then
  echo "packed $VERSION into $OUT"
  exit 0
fi

for package in "${PACKAGES[@]}"; do
  name="$(jq -r .name "packages/$package/package.json")"
  tarball="$OUT/$(tr -d @ <<<"$name" | tr / -)-$VERSION.tgz"
  npm publish "$tarball" --tag alpha --access public
done
