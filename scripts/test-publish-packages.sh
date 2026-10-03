#!/usr/bin/env bash
# .github/scripts/publish-packages.sh packs what npm gets: every published
# `@domicile/*` package at `0.0.0-alpha-<sha>`, depending on its siblings at
# that same version, with no `workspace:` or `catalog:` left for npm to choke
# on, and the working tree as it found it.
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
before="$(git -C "$ROOT" status --porcelain)"
version="0.0.0-alpha-$(git -C "$ROOT" rev-parse --short=12 HEAD)"

if ! DOMICILE_PUBLISH_DRY_RUN="$OUT" "$PUBLISH" >"$OUT/log" 2>&1; then
  fail "the dry run succeeds" "$(tail -20 "$OUT/log")"
fi

for name in sdk component-library manganese; do
  tarball="$(ls "$OUT"/domicile-"$name"-*.tgz 2>/dev/null | head -1)"
  if [ -z "$tarball" ]; then
    fail "@domicile/$name is packed" "no tarball in $OUT"
    continue
  fi
  manifest="$(tar -xzOf "$tarball" package/package.json)"
  [ "$(jq -r .version <<<"$manifest")" = "$version" ] &&
    ok "@domicile/$name is $version" ||
    fail "@domicile/$name is $version" "$(jq -r .version <<<"$manifest")"
  if grep -qE '"(workspace|catalog):' <<<"$manifest"; then
    fail "@domicile/$name names no workspace: or catalog: range" "$manifest"
  else
    ok "@domicile/$name names no workspace: or catalog: range"
  fi
  [ "$(jq -r .repository.url <<<"$manifest")" = "git+https://github.com/cprussin/domicile.git" ] &&
    ok "@domicile/$name names its repository, as provenance needs" ||
    fail "@domicile/$name names its repository, as provenance needs" "$(jq .repository <<<"$manifest")"
done

manganese="$(ls "$OUT"/domicile-manganese-*.tgz 2>/dev/null | head -1)"
if [ -n "$manganese" ]; then
  [ "$(tar -xzOf "$manganese" package/package.json | jq -r '.dependencies["@domicile/sdk"]')" = "$version" ] &&
    ok "manganese depends on the sdk of its own commit" ||
    fail "manganese depends on the sdk of its own commit" "$(tar -xzOf "$manganese" package/package.json | jq .dependencies)"
  tar -tzf "$manganese" | grep -q '^package/styled-system/css/index.mjs$' &&
    ok "manganese ships its generated styled-system" ||
    fail "manganese ships its generated styled-system" "$(tar -tzf "$manganese" | head)"
fi
sdk="$(ls "$OUT"/domicile-sdk-*.tgz 2>/dev/null | head -1)"
if [ -n "$sdk" ]; then
  tar -tzf "$sdk" | grep -q '^package/dist/domicile-client.js$' &&
    ok "the sdk ships its built dist" ||
    fail "the sdk ships its built dist" "$(tar -tzf "$sdk" | head)"
fi

[ "$(git -C "$ROOT" status --porcelain)" = "$before" ] &&
  ok "the working tree is as it was" ||
  fail "the working tree is as it was" "$(git -C "$ROOT" status --porcelain)"

[ "$FAILED" -eq 0 ]
