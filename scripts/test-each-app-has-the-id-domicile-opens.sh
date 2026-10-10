#!/usr/bin/env bash
# Checks that each of Domicile's own apps has, from its manifest `key`, the id
# `domicile_launch::apps` opens it at.
#
# Chrome derives an extension's id from its key: the first 128 bits of the
# SHA-256 of the key, one letter from `a` to `p` per hex digit. A new key with
# the old id in `apps.rs` opens a page no extension serves, and for Settings,
# lets no extension start its native messaging host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$ROOT/packages/domicile-launch/src/apps.rs"
failed=0

# app package, the constant in apps.rs that names its page
for app in "history HISTORY" "settings SETTINGS"; do
  read -r name constant <<<"$app"
  manifest="$ROOT/packages/app-$name/public/manifest.json"
  key="$(sed -n 's/^ *"key": "\([^"]*\)",*$/\1/p' "$manifest")"
  if [ -z "$key" ]; then
    echo "  FAIL  $manifest has no key, so the app's id changes with its path" >&2
    failed=1
    continue
  fi
  id="$(printf '%s' "$key" | base64 -d | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
  opened="$(sed -n "s|^pub const $constant: &str = \"chrome-extension://\([a-p]*\)/.*|\1|p" "$APPS")"
  if [ "$id" != "$opened" ]; then
    echo "  FAIL  app-$name's key gives the id $id," >&2
    echo "        and apps.rs's $constant opens ${opened:-nothing}" >&2
    failed=1
  else
    echo "  ok    $constant opens $id, app-$name's id"
  fi
done
exit "$failed"
