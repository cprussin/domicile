#!/usr/bin/env bash
# Tests that .github/scripts/publish-packages.sh packs each published
# `@domicile-desktop/*` package at `0.0.0-alpha-<sha>`, with siblings at the
# same version, no `workspace:` or `catalog:` ranges, and the working tree
# unchanged.
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

if ! DOMICILE_PUBLISH_DRY_RUN="$OUT" "$PUBLISH" >"$OUT/log" 2>&1; then
  fail "the dry run succeeds" "$(tail -20 "$OUT/log")"
fi

for name in sdk system-battery component-library manganese; do
  tarball="$(ls "$OUT"/domicile-desktop-"$name"-*.tgz 2>/dev/null | head -1)"
  if [ -z "$tarball" ]; then
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

manganese="$(ls "$OUT"/domicile-desktop-manganese-*.tgz 2>/dev/null | head -1)"
if [ -n "$manganese" ]; then
  [ "$(tar -xzOf "$manganese" package/package.json | jq -r '.dependencies["@domicile-desktop/sdk"]')" = "$version" ] &&
    ok "manganese depends on the sdk of its own commit" ||
    fail "manganese depends on the sdk of its own commit" "$(tar -xzOf "$manganese" package/package.json | jq .dependencies)"
  tar -tzf "$manganese" | grep -q '^package/styled-system/css/index.mjs$' &&
    ok "manganese ships its generated styled-system" ||
    fail "manganese ships its generated styled-system" "$(tar -tzf "$manganese" | head)"
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

[ "$(tree)" = "$before" ] &&
  ok "the working tree is as it was" ||
  fail "the working tree is as it was" "$(git -C "$ROOT" status --porcelain)"

[ "$FAILED" -eq 0 ]
