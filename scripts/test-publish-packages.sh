#!/usr/bin/env bash
# Tests that .github/scripts/publish-packages.sh packs each published
# `@domicile-desktop/*` package at `0.0.0-alpha-<sha>` for the `next`
# dist-tag, with siblings at the same version, no `workspace:` or `catalog:`
# ranges, and the working tree unchanged. A release packs each package at its
# committed version for the `latest` dist-tag.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH="$ROOT/.github/scripts/publish-packages.sh"
[ -x "$PUBLISH" ] || { echo "no $PUBLISH" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
tree() { git -C "$ROOT" status --porcelain; git -C "$ROOT" diff | sha256sum; }
before="$(tree)"
version="0.0.0-alpha-$(git -C "$ROOT" rev-parse --short=12 HEAD)"

public="$(cd "$ROOT/packages" && for manifest in */package.json; do
  [ "$(jq -r .private "$manifest")" = "false" ] && dirname "$manifest"
done | sort)"
listed="$(grep -v '^\(#\|$\)' "$ROOT/.github/scripts/published-packages" | sort)"
[ "$public" = "$listed" ] &&
  ok "every public package is in published-packages, and nothing else" ||
  fail "every public package is in published-packages, and nothing else" "$(diff <(echo "$public") <(echo "$listed"))"

if ! DOMICILE_PUBLISH_DRY_RUN="$OUT" "$PUBLISH" >"$OUT/log" 2>&1; then
  fail "the dry run succeeds" "$(tail -20 "$OUT/log")"
fi
grep -q "under the next dist-tag" "$OUT/log" &&
  ok "publishes under next, leaving latest to releases" ||
  fail "publishes under next, leaving latest to releases" "$(tail -3 "$OUT/log")"

MANGANESE=(
  manganese manganese-host manganese-address manganese-bar manganese-page-requests
  manganese-window-management manganese-launcher manganese-notifications
  manganese-clipboard manganese-wallpaper manganese-lock
)
for module in battery bluetooth brightness clock launcher-button mode network notifications sharing theme-switch tray volume workspace-switcher; do
  MANGANESE+=("manganese-bar-module-$module")
done
for name in sdk system-apps system-audio system-backlight system-battery component-library system-network system-bluetooth "${MANGANESE[@]}"; do
  tarball="$OUT/domicile-desktop-$name-$version.tgz"
  if [ ! -f "$tarball" ]; then
    fail "@domicile-desktop/$name is packed" "no tarball in $OUT"
    continue
  fi
  manifest="$(tar -xzOf "$tarball" package/package.json)"
  [ "$(jq -r .version <<<"$manifest")" = "$version" ] &&
    ok "@domicile-desktop/$name is $version" ||
    fail "@domicile-desktop/$name is $version" "$(jq -r .version <<<"$manifest")"
  if grep -qE '"(workspace|catalog):' <<<"$manifest"; then
    fail "@domicile-desktop/$name names no workspace: or catalog: range" "$manifest"
  else
    ok "@domicile-desktop/$name names no workspace: or catalog: range"
  fi
  [ "$(jq -r .repository.url <<<"$manifest")" = "git+https://github.com/cprussin/domicile.git" ] &&
    ok "@domicile-desktop/$name names its repository, as provenance needs" ||
    fail "@domicile-desktop/$name names its repository, as provenance needs" "$(jq .repository <<<"$manifest")"
done

manganese="$OUT/domicile-desktop-manganese-$version.tgz"
if [ -f "$manganese" ]; then
  [ "$(tar -xzOf "$manganese" package/package.json | jq -r '.dependencies["@domicile-desktop/sdk"]')" = "$version" ] &&
    ok "manganese depends on the sdk of its own commit" ||
    fail "manganese depends on the sdk of its own commit" "$(tar -xzOf "$manganese" package/package.json | jq .dependencies)"
  tar -tzf "$manganese" | grep -q '^package/styled-system/css/index.mjs$' &&
    ok "manganese ships its generated styled-system" ||
    fail "manganese ships its generated styled-system" "$(tar -tzf "$manganese" | head)"
fi
tray="$OUT/domicile-desktop-manganese-bar-module-tray-$version.tgz"
if [ -f "$tray" ]; then
  [ "$(tar -xzOf "$tray" package/package.json | jq -r '.dependencies["@domicile-desktop/manganese-host"]')" = "$version" ] &&
    ok "a bar module depends on manganese's packages of its own commit" ||
    fail "a bar module depends on manganese's packages of its own commit" "$(tar -xzOf "$tray" package/package.json | jq .dependencies)"
  tar -tzf "$tray" | grep -q '^package/styled-system/css/index.mjs$' &&
    ok "a bar module ships its generated styled-system" ||
    fail "a bar module ships its generated styled-system" "$(tar -tzf "$tray" | head)"
fi
sdk="$(ls "$OUT"/domicile-desktop-sdk-*.tgz 2>/dev/null | head -1)"
if [ -n "$sdk" ]; then
  tar -tzf "$sdk" | grep -q '^package/dist/domicile-host.js$' &&
    ok "the sdk ships its built dist" ||
    fail "the sdk ships its built dist" "$(tar -tzf "$sdk" | head)"
fi
battery="$(ls "$OUT"/domicile-desktop-system-battery-*.tgz 2>/dev/null | head -1)"
if [ -n "$battery" ]; then
  tar -tzf "$battery" | grep -q '^package/dist/battery.js$' &&
    ok "system-battery ships its built dist" ||
    fail "system-battery ships its built dist" "$(tar -tzf "$battery" | head)"
fi

echo "a release"
RELEASE="$OUT/release"
mkdir -p "$RELEASE"
if ! DOMICILE_RELEASE=1 DOMICILE_PUBLISH_DRY_RUN="$RELEASE" "$PUBLISH" >"$OUT/release.log" 2>&1; then
  fail "the release dry run succeeds" "$(tail -20 "$OUT/release.log")"
fi
grep -q "under the latest dist-tag" "$OUT/release.log" &&
  ok "publishes under latest" ||
  fail "publishes under latest" "$(tail -3 "$OUT/release.log")"
committed() { # package directory
  jq -r .version "$ROOT/packages/$1/package.json"
}
for package in sdk:chrome-sdk manganese:shell-manganese; do
  tarball="$RELEASE/domicile-desktop-${package%%:*}-$(committed "${package#*:}").tgz"
  [ -f "$tarball" ] &&
    ok "@domicile-desktop/${package%%:*} is packed at its committed version" ||
    fail "@domicile-desktop/${package%%:*} is packed at its committed version" "$(ls "$RELEASE")"
done
manganese="$RELEASE/domicile-desktop-manganese-$(committed shell-manganese).tgz"
if [ -f "$manganese" ]; then
  [ "$(tar -xzOf "$manganese" package/package.json | jq -r '.dependencies["@domicile-desktop/sdk"]')" = "$(committed chrome-sdk)" ] &&
    ok "manganese depends on the sdk's committed version" ||
    fail "manganese depends on the sdk's committed version" "$(tar -xzOf "$manganese" package/package.json | jq .dependencies)"
fi

[ "$(tree)" = "$before" ] &&
  ok "the working tree is as it was" ||
  fail "the working tree is as it was" "$(git -C "$ROOT" status --porcelain)"

[ "$FAILED" -eq 0 ]
