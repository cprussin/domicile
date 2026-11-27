#!/usr/bin/env bash
# Build uBlock Origin's scriptlets as the resources file the engine fetches,
# check it is the one the config pins, and with `--publish` put it on a release
# in the builds repository.
#
#   .github/scripts/scriptlet-resources.sh [--publish]
#
# The config's default `browser.scriptlet_resources`
# (DEFAULT_SCRIPTLET_RESOURCES in packages/domicile-config/src/lib.rs) names
# `ublock-origin-scriptlets-<version>/scriptlets.json` in the builds
# repository and pins it by its sha256, so the engine runs nothing but what
# this built. This clones uBlock Origin at UBO_VERSION, checks the tag is
# still UBO_COMMIT, and builds it with scriptlet-resources.ts. A build whose
# sha256 is not the pin fails and says the one to pin: bumping uBlock Origin
# is UBO_VERSION, UBO_COMMIT and the default, in one pull request.
#
# A release that is there is only checked against the pin, never rebuilt or
# replaced, since engines in the wild check its hash. `--publish` creates it
# when it is missing. `GH_TOKEN` needs Contents: write on `DOMICILE_BUILDS_REPO` (default
# `cprussin/domicile-builds`), where engine-release-publish.sh puts the
# engines, so people watching this repository hear only of real releases.
#
# uBlock Origin's scriptlets are GPL-3.0, so the release is their own, apart
# from Domicile's MIT code, with their source named.
#
# Overrides for tests: UBO_CHECKOUT, a checkout to build in place of a clone;
# SCRIPTLETS_CONFIG, the file the pin is read from; SCRIPTLETS_PUBLISHED, a
# file to take for the published one, or `none`.
set -euo pipefail

UBO_VERSION=1.77.2
UBO_COMMIT=f1fa299dc5ef105f2ae3759e0f3ae7bf9fd796cf
UBO_REPO=https://github.com/gorhill/uBlock

PUBLISH=0
case "${1:-}" in
  ("") ;;
  (--publish) PUBLISH=1 ;;
  (*)
    echo "usage: scriptlet-resources.sh [--publish]" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="${SCRIPTLETS_CONFIG:-$ROOT/packages/domicile-config/src/lib.rs}"
BUILDS_REPO="${DOMICILE_BUILDS_REPO:-cprussin/domicile-builds}"
TAG="ublock-origin-scriptlets-$UBO_VERSION"
URL="https://github.com/$BUILDS_REPO/releases/download/$TAG/scriptlets.json"

# The pin: the default's address, then its hash.
PINNED="$(grep -o 'DEFAULT_SCRIPTLET_RESOURCES: &str = "[^"]*"' "$CONFIG" | cut -d'"' -f2 || true)"
[ -n "$PINNED" ] || {
  echo "no DEFAULT_SCRIPTLET_RESOURCES in $CONFIG" >&2
  exit 1
}
case "$PINNED" in
  ("$URL#sha256="*) PIN="${PINNED##*#sha256=}" ;;
  (*)
    echo "DEFAULT_SCRIPTLET_RESOURCES is $PINNED, not $URL#sha256=...: bump UBO_VERSION here with it" >&2
    exit 1
    ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A release that is there is the pin or something is wrong: it is never
# rebuilt, so a newer bun, which prints the functions' source its own way,
# changes nothing published.
if [ -n "${SCRIPTLETS_PUBLISHED:-}" ]; then
  [ "$SCRIPTLETS_PUBLISHED" = none ] || cp "$SCRIPTLETS_PUBLISHED" "$work/published.json"
else
  status="$(curl -sSL --retry 4 -o "$work/published.json" -w '%{http_code}' "$URL")" || {
    echo "could not ask for $URL" >&2
    exit 1
  }
  case "$status" in
    (200) ;;
    (404) rm -f "$work/published.json" ;;
    (*)
      echo "$URL answered $status" >&2
      exit 1
      ;;
  esac
fi
if [ -f "$work/published.json" ]; then
  PUBLISHED="$(sha256sum "$work/published.json" | cut -d' ' -f1)"
  [ "$PUBLISHED" = "$PIN" ] || {
    echo "$URL is $PUBLISHED, not the pinned $PIN: pin $URL#sha256=$PUBLISHED if it is the one, or a new version" >&2
    exit 1
  }
  echo "$TAG is published, and is the pin"
  exit 0
fi

CHECKOUT="${UBO_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  CHECKOUT="$work/uBlock"
  git clone --quiet --depth 1 --branch "$UBO_VERSION" "$UBO_REPO" "$CHECKOUT"
  at="$(git -C "$CHECKOUT" rev-parse HEAD)"
  [ "$at" = "$UBO_COMMIT" ] || {
    echo "uBlock Origin's $UBO_VERSION is $at, not $UBO_COMMIT: the tag moved, so nothing is built from it" >&2
    exit 1
  }
fi

# Its own directory, apart from the checkout, so nothing in the checkout is
# taken for this script's.
mkdir "$work/out"
bun "$ROOT/.github/scripts/scriptlet-resources.ts" "$CHECKOUT" "$work/out/scriptlets.json"
BUILT="$(sha256sum "$work/out/scriptlets.json" | cut -d' ' -f1)"
echo "built $TAG/scriptlets.json, sha256 $BUILT"
[ "$BUILT" = "$PIN" ] || {
  echo "the build's sha256 is $BUILT, but DEFAULT_SCRIPTLET_RESOURCES pins $PIN: pin $URL#sha256=$BUILT" >&2
  exit 1
}

if [ "$PUBLISH" = 0 ]; then
  echo "$TAG is not published yet; a push to main publishes it"
  exit 0
fi
: "${GH_TOKEN:?a token with Contents: write on $BUILDS_REPO is required}"

cat >"$work/notes.md" <<NOTES
uBlock Origin $UBO_VERSION's scriptlets ($UBO_REPO/tree/$UBO_COMMIT/src/js/resources), as the resources file Domicile's engine runs for filter lists' \`##+js(...)\` rules.

They are uBlock Origin's, under the GPL-3.0 (https://github.com/gorhill/uBlock/blob/$UBO_COMMIT/LICENSE.txt), built by .github/scripts/scriptlet-resources.ts in cprussin/domicile at ${GITHUB_SHA:-a local checkout}. Those that need a trusted list are left out, and those uBlock Origin runs in its isolated world run in the page's.

sha256: $PIN
NOTES
gh release create "$TAG" "$work/out/scriptlets.json" --repo "$BUILDS_REPO" \
  --title "uBlock Origin $UBO_VERSION scriptlets" --notes-file "$work/notes.md"
echo "published $URL"
