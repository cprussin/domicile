#!/usr/bin/env bash
# Remove the placeholder `.github/scripts/npm-claim.sh` published, once
# `publish-packages.yml` has published an alpha: point `latest` at the alpha on
# `next`, as on the other packages, then drop the `placeholder` dist-tag and
# unpublish `0.0.0-0` and the `0.0.0-stage` npm adds when it creates a package.
# Skips what is already gone, so it can run again.
#
# Run as an owner of the scope, logged in (`npm login`):
#   nix run .#npm-claim-cleanup -- @domicile-desktop/<name>
set -euo pipefail

PKG="${1:?usage: npm-claim-cleanup @domicile-desktop/<name>}"
PLACEHOLDER=0.0.0-0

[[ "$PKG" == @domicile-desktop/* ]] || { echo "$PKG is not in @domicile-desktop" >&2; exit 1; }
# Unpublishing a package's only version deletes the package and its trusted
# publisher.
NEXT="$(npm view "$PKG" dist-tags.next)"
if [ -z "$NEXT" ] || [ "$NEXT" = "$PLACEHOLDER" ]; then
  echo "$PKG has no alpha on next yet; wait for publish-packages.yml" >&2
  exit 1
fi

npm dist-tag add "$PKG@$NEXT" latest
if [ -n "$(npm view "$PKG" dist-tags.placeholder)" ]; then
  npm dist-tag rm "$PKG" placeholder
fi
# `npm view --json` gives one version as a string, several as an array.
mapfile -t VERSIONS < <(npm view "$PKG" versions --json | jq -r 'if type == "array" then .[] else . end')
for version in "$PLACEHOLDER" 0.0.0-stage; do
  if printf '%s\n' "${VERSIONS[@]}" | grep -qxF "$version"; then
    npm unpublish "$PKG@$version"
  fi
done
echo "$PKG: latest is $NEXT, placeholders removed"
