#!/usr/bin/env bash
# Checks that the extensions the desk installs survive a restart, data and all.
#
# At every start Chrome uninstalls each extension at an external location
# that no external provider lists (ExternalProviderManager's
# CheckExternalUninstall), and the desk's config is no provider. Installed as
# `kExternalPrefDownload`, every config and mirrored extension was wiped and
# reinstalled each start, signed out, its settings gone.
#
# Reads the sources, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/packages/domicile-engine/src/chrome/browser/domicile"
[ -d "$SRC" ] || { echo "no engine sources at $SRC" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

for file in domicile_extension_installer.cc domicile_browser_profiles.cc; do
  if ! grep -q 'AddFromExternalUpdateUrl' "$SRC/$file"; then
    fail "$file installs from the Web Store" "no AddFromExternalUpdateUrl in it"
  elif grep -q 'ManifestLocation::kExternal' "$SRC/$file"; then
    fail "$file installs at a location Chrome keeps" \
      "it installs at an external location, which Chrome uninstalls at the next start"
  elif grep -q 'ManifestLocation::kInternal' "$SRC/$file"; then
    ok "$file installs at a location Chrome keeps"
  else
    fail "$file installs at a location Chrome keeps" "it names no kInternal location"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
