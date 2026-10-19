#!/usr/bin/env bash
# Tests `scripts/stamp-version.sh`, which gives the manifests that npm, the
# distribution packages and the flake ship the version of their commit.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$ROOT/scripts/stamp-version.sh"
[ -x "$STAMP" ] || { echo "no $STAMP" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}

REV=0123456789abcdef0123456789abcdef01234567
reset() {
  for package in sdk shell; do
    mkdir -p "$WORK/$package"
    printf '{"name":"@domicile-desktop/%s","version":"0.0.0","private":false}\n' \
      "$package" >"$WORK/$package/package.json"
  done
}

echo "a commit's version"
reset
printed="$("$STAMP" "$REV" "$WORK/sdk/package.json" "$WORK/shell/package.json" 2>&1)"
expect "prints the version" "0.0.0-alpha-0123456789ab" "$printed"
for package in sdk shell; do
  expect "stamps $package" "0.0.0-alpha-0123456789ab" \
    "$(jq -r .version "$WORK/$package/package.json")"
done
expect "keeps the other fields" '@domicile-desktop/sdk false' \
  "$(jq -r '"\(.name) \(.private)"' "$WORK/sdk/package.json")"

echo "a dirty tree's version"
reset
expect "says it is dirty" "0.0.0-alpha-0123456789ab-dirty" \
  "$("$STAMP" "$REV-dirty" "$WORK/sdk/package.json" 2>&1)"

echo "what is not a commit is refused"
for rev in 0123456789ab "" HEAD; do
  reset
  if out="$("$STAMP" "$rev" "$WORK/sdk/package.json" 2>&1)"; then
    fail "refuses '$rev'" "stamped $out"
  else
    expect "and stamps nothing for '$rev'" 0.0.0 "$(jq -r .version "$WORK/sdk/package.json")"
  fi
done

echo "the tree holds no stamped version"
stamped="$(cd "$ROOT" && for manifest in package.json packages/*/package.json; do
  version="$(jq -r '.version // "0.0.0"' "$manifest")"
  [[ "$version" != *-alpha-* ]] || echo "$manifest: $version"
done)"
expect "no manifest is an alpha" "" "$stamped"

[ "$FAILED" -eq 0 ]
