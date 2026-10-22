#!/usr/bin/env bash
# Remove the placeholder `.github/scripts/npm-claim.sh` published, once
# `publish-packages.yml` has published an alpha: point `latest` at the alpha on
# `next`, as on the other packages, then drop the `placeholder` dist-tag and
# unpublish `0.0.0-0`.
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
npm dist-tag rm "$PKG" placeholder
npm unpublish "$PKG@$PLACEHOLDER"
echo "$PKG: latest is $NEXT, placeholder removed"
