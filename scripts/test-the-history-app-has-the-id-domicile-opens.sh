#!/usr/bin/env bash
# Checks that the History app's manifest `key` gives the id `domicile-history`
# opens.
#
# Chrome derives an extension's id from its key: the first 128 bits of the
# SHA-256 of the key, one letter from `a` to `p` per hex digit. A new key with
# the old id in `domicile_launch::apps::HISTORY` opens a page no extension
# serves.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/packages/app-history/public/manifest.json"
APPS="$ROOT/packages/domicile-launch/src/apps.rs"

key="$(sed -n 's/^ *"key": "\([^"]*\)",*$/\1/p' "$MANIFEST")"
[ -n "$key" ] || {
  echo "  FAIL  $MANIFEST has no key, so the app's id changes with its path" >&2
  exit 1
}
id="$(printf '%s' "$key" | base64 -d | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
opened="$(sed -n 's|.*"chrome-extension://\([a-p]*\)/.*|\1|p' "$APPS")"

if [ "$id" != "$opened" ]; then
  echo "  FAIL  the manifest's key gives the id $id," >&2
  echo "        and domicile-history opens $opened" >&2
  exit 1
fi
echo "  ok    domicile-history opens $id, the History app's id"
