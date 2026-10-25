#!/usr/bin/env bash
# Publish every public `@domicile-desktop/*` package to npm as
# `0.0.0-alpha-<sha>` under the `next` dist-tag. With `DOMICILE_RELEASE=1`,
# publish each at the version changesets gave it, under `latest`, skipping
# those npm already has.
#
# - `bun pm pack`: bun rewrites `workspace:*` and `catalog:` to real ranges.
# - `npm publish`: npm supports trusted publishing (GitHub's OIDC token, no
#   secret) and provenance.
# - The alpha version is `scripts/stamp-version.sh`'s.
#
# DOMICILE_PUBLISH_DRY_RUN=<dir> packs into <dir> and publishes nothing, for
# packages/ci/tests/test-publish-packages.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

mapfile -t PACKAGES < <(grep -v '^\(#\|$\)' .github/scripts/published-packages)
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

MANIFESTS=()
for package in "${PACKAGES[@]}"; do
  MANIFESTS+=("packages/$package/package.json")
done
if [ "${DOMICILE_RELEASE:-}" = 1 ]; then
  TAG=latest
  VERSION="each package's own version"
else
  TAG=next
  VERSION="$(scripts/stamp-version.sh "$(git rev-parse HEAD)" "${MANIFESTS[@]}")"
  bun install --ignore-scripts
fi

# What the tarballs hold that git does not: each library's `dist/` and the
# Panda `styled-system/` the component library and manganese's packages
# import. Manganese depends on every other package published here.
bun run turbo run prepare build --filter "@domicile-desktop/manganese..."

for package in "${PACKAGES[@]}"; do
  (cd "packages/$package" && bun pm pack --quiet --ignore-scripts --destination "$OUT")
done

if [ -n "${DOMICILE_PUBLISH_DRY_RUN:-}" ]; then
  echo "packed $VERSION into $OUT, to publish under the $TAG dist-tag"
  exit 0
fi

for package in "${PACKAGES[@]}"; do
  name="$(jq -r .name "packages/$package/package.json")"
  version="$(jq -r .version "packages/$package/package.json")"
  tarball="$OUT/$(tr -d @ <<<"$name" | tr / -)-$version.tgz"
  # A release skips the packages that did not change; a rerun of a run that
  # stopped partway skips what it already published.
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version is already on npm"
    continue
  fi
  npm publish "$tarball" --tag "$TAG" --access public --provenance
done
