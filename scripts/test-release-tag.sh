#!/usr/bin/env bash
# Tests `release-tag.sh`, which tags a release and moves `release` to it: a
# `<package>@<version>` tag for each package version not tagged yet, and one
# `release-<time>` tag.
#
# Uses real `git` against a local remote, and the workspace's changesets.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$ROOT/.github/scripts/release-tag.sh"
[ -x "$TAG" ] || { echo "no $TAG" >&2; exit 1; }
[ -x "$ROOT/node_modules/.bin/changeset" ] || { echo "no changeset; run bun install" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

REPO="$WORK/repo"
git init -q --bare "$WORK/remote"
git init -q -b main "$REPO"
git -C "$REPO" config user.email ci@domicile.invalid
git -C "$REPO" config user.name "domicile CI"
git -C "$REPO" config push.negotiate false
git -C "$REPO" remote add origin "$WORK/remote"
mkdir -p "$REPO/.github/scripts" "$REPO/.changeset"
cp "$TAG" "$REPO/.github/scripts/"
cp "$ROOT/package.json" "$ROOT/bun.lock" "$REPO/"
cp "$ROOT/.changeset/config.json" "$REPO/.changeset/"
for manifest in "$ROOT"/packages/*/package.json; do
  package="$(basename "$(dirname "$manifest")")"
  mkdir -p "$REPO/packages/$package"
  jq '.version = "1.0.0"' "$manifest" >"$REPO/packages/$package/package.json"
done
ln -s "$ROOT/node_modules" "$REPO/node_modules"
echo node_modules >"$REPO/.gitignore"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "1.0.0"
git -C "$REPO" push -q origin HEAD:main

tag() { # environment...
  (cd "$REPO" && env "$@" bash .github/scripts/release-tag.sh 2>&1)
}
remote_tags() { git -C "$WORK/remote" tag | sort; }
release() { git -C "$WORK/remote" rev-parse -q --verify refs/heads/release || echo missing; }
packages() { (cd "$REPO/packages" && jq -r .name */package.json | sort); }

echo "== a dry run =="
if out="$(tag DOMICILE_RELEASE_DRY_RUN=1)"; then
  expect "pushes no tag" "" "$(remote_tags)"
  expect "and leaves release alone" missing "$(release)"
else
  printf '  FAIL  the dry run succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

echo "== the first release =="
git -C "$REPO" tag -d $(git -C "$REPO" tag) >/dev/null
sleep 1
if out="$(tag)"; then
  expect "tags every package at its version" "$(packages | sed 's/$/@1.0.0/' | sort)" \
    "$(remote_tags | grep -v '^release-')"
  expect "and the release" 1 "$(remote_tags | grep -c '^release-[0-9]\{8\}-[0-9]\{6\}$')"
  expect "and moves release to it" "$(git -C "$REPO" rev-parse HEAD)" "$(release)"
else
  printf '  FAIL  the release succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

echo "== a release that bumps one package =="
jq '.version = "1.0.1"' "$REPO/packages/chrome-sdk/package.json" >"$WORK/sdk.json"
mv "$WORK/sdk.json" "$REPO/packages/chrome-sdk/package.json"
git -C "$REPO" commit -qam "sdk 1.0.1"
before="$(remote_tags)"
sleep 1
if out="$(tag)"; then
  expect "tags only the new version, and the release" \
    "$(printf '@domicile-desktop/sdk@1.0.1\nrelease')" \
    "$(comm -13 <(echo "$before") <(remote_tags) | sed 's/^release-.*/release/' | sort)"
  expect "and moves release to it" "$(git -C "$REPO" rev-parse HEAD)" "$(release)"
else
  printf '  FAIL  the release succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ]
