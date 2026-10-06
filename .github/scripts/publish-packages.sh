#!/usr/bin/env bash
# Publish every public `@domicile-desktop/*` package to npm as
# `0.0.0-alpha-<sha>` under the `latest` dist-tag. There is no semver yet.
#
# - `bun pm pack`: bun rewrites `workspace:*` and `catalog:` to real ranges.
# - `npm publish`: npm supports trusted publishing (GitHub's OIDC token, no
#   secret) and provenance.
# - `alpha-<sha>`, not `alpha.<sha>`: semver reads an all-digit identifier as
#   numeric, and one with a leading zero is not a valid version.
#
# DOMICILE_PUBLISH_DRY_RUN=<dir> packs into <dir> and publishes nothing, for
# scripts/test-publish-packages.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Dependencies first, so a package is never on npm before what it needs.
PACKAGES=(chrome-sdk system-battery component-library shell-manganese)
VERSION="0.0.0-alpha-$(git rev-parse --short=12 HEAD)"
OUT="${DOMICILE_PUBLISH_DRY_RUN:-$(mktemp -d)}"

# Versions go into the manifests and `bun.lock`, where `bun pm pack` reads a
# sibling's version for `workspace:*`. All of it is restored on exit, because a
# dry run runs in a working copy.
SAVED="$(mktemp -d)"
restore() {
  for package in "${PACKAGES[@]}"; do
    cp "$SAVED/$package.json" "packages/$package/package.json"
  done
  cp "$SAVED/bun.lock" bun.lock
  rm -rf "$SAVED"
}
for package in "${PACKAGES[@]}"; do
  cp "packages/$package/package.json" "$SAVED/$package.json"
done
cp bun.lock "$SAVED/bun.lock"
trap restore EXIT

for package in "${PACKAGES[@]}"; do
  manifest="packages/$package/package.json"
  jq --arg version "$VERSION" '.version = $version' "$manifest" >"$manifest.next"
  mv "$manifest.next" "$manifest"
done
bun install --ignore-scripts

# What the tarballs hold that git does not: the SDK's and system-battery's
# `dist/` and the Panda `styled-system/` the other two import.
bun run turbo run prepare build \
  --filter @domicile-desktop/sdk --filter @domicile-desktop/system-battery \
  --filter @domicile-desktop/component-library --filter @domicile-desktop/manganese

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
  npm publish "$tarball" --tag latest --access public --provenance
done
