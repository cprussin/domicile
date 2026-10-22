#!/usr/bin/env bash
# Claim a new `@domicile-desktop/*` npm package so `publish-packages.yml` can
# publish it: publish a placeholder `0.0.0-0` under the `placeholder`
# dist-tag, then name the workflow its trusted publisher. npm attaches a
# trusted publisher only to a package it has.
#
# Run as an owner of the scope, logged in (`npm login`):
#   nix run .#npm-claim -- @domicile-desktop/<name>
# Once CI has published an alpha, remove the placeholder with `.#npm-claim-cleanup`.
set -euo pipefail

PKG="${1:?usage: npm-claim @domicile-desktop/<name>}"
# npm reserves `0.0.0-stage` for staged publishes.
PLACEHOLDER=0.0.0-0

[[ "$PKG" == @domicile-desktop/* ]] || { echo "$PKG is not in @domicile-desktop" >&2; exit 1; }
if npm view "$PKG" version >/dev/null 2>&1; then
  echo "$PKG is on npm already" >&2
  exit 1
fi

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
jq -n --arg name "$PKG" --arg version "$PLACEHOLDER" \
  '{name: $name, version: $version, publishConfig: {access: "public"}}' >"$DIR/package.json"
(cd "$DIR" && npm publish --access public --tag placeholder)

npm trust github "$PKG" --repo cprussin/domicile --file publish-packages.yml --allow-publish --yes
echo "claimed $PKG; publish-packages.yml publishes it on the next merge to main"
