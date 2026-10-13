#!/usr/bin/env bash
# Tests `scripts/npm-bootstrap.sh`, which creates new packages on npm, gives
# them their trusted publisher, and retires the placeholder versions.
#
# Runs it with an `npm` that records its arguments and answers from files in
# `$WORK/registry`: `<key>.versions` and `<key>.latest` for a package on npm,
# `<key>.trust` for one with a trusted publisher. A key is the name with its
# slash as `+`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOTSTRAP="$ROOT/scripts/npm-bootstrap.sh"
[ -x "$BOOTSTRAP" ] || { echo "no $BOOTSTRAP" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || { echo "  SKIP: no jq"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
contains() { # what, needle, hay
  case "$3" in
    (*"$2"*) ok "$1" ;;
    (*) fail "$1" "expected: $2  in: $3" ;;
  esac
}
lacks() { # what, needle, hay
  case "$3" in
    (*"$2"*) fail "$1" "unexpected: $2  in: $3" ;;
    (*) ok "$1" ;;
  esac
}

mkdir -p "$WORK/bin" "$WORK/registry"
cat >"$WORK/bin/npm" <<'NPM'
#!/usr/bin/env bash
registry="$NPM_FAKE_REGISTRY"
echo "npm $*" >>"$registry/calls"
key() { tr / + <<<"$1"; }
case "$1 $2" in
  "whoami "*) echo maintainer ;;
  "view "*)
    [ -f "$registry/$(key "$2").versions" ] || { echo "npm error code E404" >&2; exit 1; }
    case "$3" in
      versions) jq -R . <"$registry/$(key "$2").versions" | jq -s . ;;
      dist-tags.latest) cat "$registry/$(key "$2").latest" ;;
    esac
    ;;
  "publish "*) jq -r .name "$2/package.json" >>"$registry/published" ;;
  "trust list") cat "$registry/$(key "$3").trust" 2>/dev/null || echo "[]" ;;
  "trust github") ;;
  "dist-tag rm") ;;
  "unpublish "*) [ ! -f "$registry/refuse-unpublish" ] || exit 1 ;;
  "deprecate "*) ;;
  *) echo "fake npm: unexpected: $*" >&2; exit 1 ;;
esac
NPM
chmod +x "$WORK/bin/npm"
export PATH="$WORK/bin:$PATH" NPM_FAKE_REGISTRY="$WORK/registry"

# The published packages; the first is on npm already, the rest are new.
mapfile -t DIRS < <(grep -v '^\(#\|$\)' "$ROOT/.github/scripts/published-packages")
name_of() { jq -r .name "$ROOT/packages/$1/package.json"; }
key() { tr / + <<<"$1"; }
OLD="$(name_of "${DIRS[0]}")"
NEW="$(name_of "${DIRS[1]}")"
echo "0.0.0-alpha-abc" >"$WORK/registry/$(key "$OLD").versions"
echo "0.0.0-alpha-abc" >"$WORK/registry/$(key "$OLD").latest"

echo "the published list"
for dir in "${DIRS[@]}"; do
  [ "$(jq -r .private "$ROOT/packages/$dir/package.json")" = "false" ] ||
    fail "$dir is public" "private is not false"
done
public="$(cd "$ROOT/packages" && for manifest in */package.json; do
  [ "$(jq -r .private "$manifest")" = "false" ] && dirname "$manifest"
done | sort)"
[ "$public" = "$(printf '%s\n' "${DIRS[@]}" | sort)" ] &&
  ok "every public package is published, and nothing else" ||
  fail "every public package is published, and nothing else" "$(diff <(echo "$public") <(printf '%s\n' "${DIRS[@]}" | sort))"

echo "claim"
"$BOOTSTRAP" claim >"$WORK/log" 2>&1 || fail "claim succeeds" "$(cat "$WORK/log")"
published="$(cat "$WORK/registry/published" 2>/dev/null)"
contains "a new package gets a placeholder" "$NEW" "$published"
lacks "a package on npm is left alone" "$OLD" "$published"
calls="$(cat "$WORK/registry/calls")"
contains "the placeholder is 0.0.0-0 under its own tag" "--tag placeholder" "$calls"
contains "the placeholder is public" "--access public" "$calls"

echo "trust"
echo '[{"file":"publish-packages.yml","repository":"cprussin/domicile"}]' >"$WORK/registry/$(key "$OLD").trust"
: >"$WORK/registry/calls"
"$BOOTSTRAP" trust >"$WORK/log" 2>&1 || fail "trust succeeds" "$(cat "$WORK/log")"
calls="$(cat "$WORK/registry/calls")"
contains "a new package trusts the publish workflow" \
  "npm trust github $NEW --file publish-packages.yml --repo cprussin/domicile --allow-publish --yes" "$calls"
lacks "a package that trusts it already is left alone" "npm trust github $OLD " "$calls"

echo "retire"
for dir in "${DIRS[@]:1}"; do
  printf '0.0.0-0\n0.0.0-alpha-abc\n' >"$WORK/registry/$(key "$(name_of "$dir")").versions"
  echo "0.0.0-alpha-abc" >"$WORK/registry/$(key "$(name_of "$dir")").latest"
done
: >"$WORK/registry/calls"
"$BOOTSTRAP" retire >"$WORK/log" 2>&1 || fail "retire succeeds" "$(cat "$WORK/log")"
calls="$(cat "$WORK/registry/calls")"
contains "the placeholder tag is dropped" "npm dist-tag rm $NEW placeholder" "$calls"
contains "the placeholder version is unpublished" "npm unpublish $NEW@0.0.0-0" "$calls"
lacks "a package without a placeholder is left alone" "npm unpublish $OLD@" "$calls"

touch "$WORK/registry/refuse-unpublish"
: >"$WORK/registry/calls"
"$BOOTSTRAP" retire >"$WORK/log" 2>&1 || fail "retire succeeds when npm refuses an unpublish" "$(cat "$WORK/log")"
calls="$(cat "$WORK/registry/calls")"
contains "a placeholder npm will not unpublish is deprecated" "npm deprecate $NEW@0.0.0-0" "$calls"
rm "$WORK/registry/refuse-unpublish"

echo "0.0.0-0" >"$WORK/registry/$(key "$NEW").latest"
"$BOOTSTRAP" retire >"$WORK/log" 2>&1 &&
  fail "retire refuses while a placeholder is the latest" "it succeeded" ||
  contains "retire refuses while a placeholder is the latest" "$NEW" "$(cat "$WORK/log")"

if [ "$FAILED" -ne 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
