#!/usr/bin/env bash
# Tests `.github/scripts/npm-claim.sh` and `npm-claim-cleanup.sh`, which claim
# a new npm package for trusted publishing and then remove the placeholder,
# against a stand-in `npm` that records its calls.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAIM="$ROOT/.github/scripts/npm-claim.sh"
CLEANUP="$ROOT/.github/scripts/npm-claim-cleanup.sh"
for script in "$CLAIM" "$CLEANUP"; do
  [ -x "$script" ] || { echo "no $script" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

PKG=@domicile-desktop/example

# The stand-in registry: `$WORK/registry/versions` lists the package's
# versions, `$WORK/registry/tag-<name>` holds a dist-tag. Every call is
# appended to `$WORK/calls`; a `publish` also records the manifest it packed.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/npm" <<'EOF'
#!/usr/bin/env bash
REG="$NPM_STAND_IN/registry"
echo "$*" >>"$NPM_STAND_IN/calls"
case "$1" in
  view)
    [ -s "$REG/versions" ] || { echo "E404" >&2; exit 1; }
    case "$3" in
      versions) tr '\n' ' ' <"$REG/versions" ;;
      dist-tags.*) cat "$REG/tag-${3#dist-tags.}" 2>/dev/null ;;
      *) tail -1 "$REG/versions" ;;
    esac
    ;;
  publish) cp package.json "$NPM_STAND_IN/published.json" ;;
  trust) [ "$2" = --help ] || true ;;
  dist-tag)
    case "$2" in
      add) echo "${3##*@}" >"$REG/tag-$4" ;;
      rm) rm -f "$REG/tag-$4" ;;
    esac
    ;;
  unpublish) grep -vxF "${2##*@}" "$REG/versions" >"$REG/v" ; mv "$REG/v" "$REG/versions" ;;
esac
EOF
chmod +x "$WORK/bin/npm"
export NPM_STAND_IN="$WORK"
export PATH="$WORK/bin:$PATH"

reset() {
  rm -rf "$WORK/registry" "$WORK/calls" "$WORK/published.json"
  mkdir -p "$WORK/registry"
  : >"$WORK/registry/versions"
  : >"$WORK/calls"
}

# claim
reset
if "$CLAIM" "$PKG" >"$WORK/log" 2>&1; then
  ok "claims a package npm does not have"
else
  fail "claims a package npm does not have" "$(tail -5 "$WORK/log")"
fi
[ "$(jq -r '"\(.name) \(.version)"' "$WORK/published.json" 2>/dev/null)" = "$PKG 0.0.0-0" ] &&
  ok "publishes the placeholder $PKG@0.0.0-0" ||
  fail "publishes the placeholder $PKG@0.0.0-0" "$(cat "$WORK/published.json" 2>/dev/null)"
grep -qx 'publish --access public --tag placeholder' "$WORK/calls" &&
  ok "publishes it public, under the placeholder dist-tag" ||
  fail "publishes it public, under the placeholder dist-tag" "$(cat "$WORK/calls")"
grep -qx "trust github $PKG --repo cprussin/domicile --file publish-packages.yml --allow-publish --yes" "$WORK/calls" &&
  ok "names publish-packages.yml its trusted publisher" ||
  fail "names publish-packages.yml its trusted publisher" "$(cat "$WORK/calls")"

reset
echo 0.0.0-alpha-abc >"$WORK/registry/versions"
if "$CLAIM" "$PKG" >"$WORK/log" 2>&1; then
  fail "refuses a package npm already has" "it succeeded"
else
  ! grep -q '^publish' "$WORK/calls" &&
    ok "refuses a package npm already has" ||
    fail "refuses a package npm already has" "$(cat "$WORK/calls")"
fi

reset
if "$CLAIM" example >"$WORK/log" 2>&1; then
  fail "refuses a name outside @domicile-desktop" "it succeeded"
else
  ok "refuses a name outside @domicile-desktop"
fi

# cleanup
reset
printf '0.0.0-0\n0.0.0-alpha-abc\n' >"$WORK/registry/versions"
echo 0.0.0-0 >"$WORK/registry/tag-latest"
echo 0.0.0-0 >"$WORK/registry/tag-placeholder"
echo 0.0.0-alpha-abc >"$WORK/registry/tag-next"
if "$CLEANUP" "$PKG" >"$WORK/log" 2>&1; then
  ok "cleans up once CI has published an alpha"
else
  fail "cleans up once CI has published an alpha" "$(tail -5 "$WORK/log")"
fi
[ "$(cat "$WORK/registry/tag-latest")" = 0.0.0-alpha-abc ] &&
  ok "points latest at the alpha on next, as the other packages have" ||
  fail "points latest at the alpha on next, as the other packages have" "$(cat "$WORK/registry/tag-latest")"
[ ! -e "$WORK/registry/tag-placeholder" ] &&
  ok "removes the placeholder dist-tag" ||
  fail "removes the placeholder dist-tag" "$(cat "$WORK/calls")"
[ "$(cat "$WORK/registry/versions")" = 0.0.0-alpha-abc ] &&
  ok "unpublishes the placeholder" ||
  fail "unpublishes the placeholder" "$(cat "$WORK/registry/versions")"

reset
echo 0.0.0-0 >"$WORK/registry/versions"
echo 0.0.0-0 >"$WORK/registry/tag-latest"
echo 0.0.0-0 >"$WORK/registry/tag-placeholder"
if "$CLEANUP" "$PKG" >"$WORK/log" 2>&1; then
  fail "refuses to clean up before an alpha, which would delete the package" "it succeeded"
else
  ! grep -q '^unpublish' "$WORK/calls" &&
    ok "refuses to clean up before an alpha, which would delete the package" ||
    fail "refuses to clean up before an alpha, which would delete the package" "$(cat "$WORK/calls")"
fi

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed" >&2; exit 1; }
echo "all passed"
