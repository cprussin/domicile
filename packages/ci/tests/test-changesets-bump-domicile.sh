#!/usr/bin/env bash
# Tests that `bun run version-packages` bumps `domicile`, the distribution
# package, when a package it bundles changes, and leaves it alone otherwise,
# and records the new versions in `bun.lock`.
#
# `packages/domicile/package.json` stands for the distribution package. It
# depends on the bundled workspace packages, and `.changeset/config.json` bumps
# dependents on every release, so a bundled change reaches it.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CHANGESET="$ROOT/node_modules/.bin/changeset"
[ -x "$CHANGESET" ] || { echo "no $CHANGESET; run bun install" >&2; exit 1; }

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

# A copy of the workspace's manifests and changesets config, with one changeset.
# Every package is at 1.0.0, past the 0.x ranges that bump dependents anyway.
reset() { # package
  rm -rf "$WORK/repo"
  mkdir -p "$WORK/repo/.changeset"
  cp "$ROOT/package.json" "$ROOT/bun.lock" "$WORK/repo/"
  cp "$ROOT/.changeset/config.json" "$WORK/repo/.changeset/"
  for manifest in "$ROOT"/packages/*/package.json; do
    package="$(basename "$(dirname "$manifest")")"
    mkdir -p "$WORK/repo/packages/$package"
    jq '.version = "1.0.0"' "$manifest" >"$WORK/repo/packages/$package/package.json"
  done
  printf -- '---\n"%s": patch\n---\n\nA change.\n' "$1" >"$WORK/repo/.changeset/a-change.md"
  ln -s "$ROOT/node_modules" "$WORK/repo/node_modules"
  git -C "$WORK/repo" init -q
}

version_packages() {
  (cd "$WORK/repo" && bun run version-packages 2>&1)
}

version_of() { # package directory
  jq -r .version "$WORK/repo/packages/$1/package.json"
}

for package in @domicile-desktop/shell-simple @domicile-desktop/sdk; do
  echo "a change to $package"
  reset "$package"
  if out="$(version_packages)"; then
    expect "bumps domicile" 1.0.1 "$(version_of domicile)"
    expect "records it in bun.lock" 1.0.1 \
      "$(grep -A2 '"packages/domicile": {' "$WORK/repo/bun.lock" | sed -n 's/.*"version": "\(.*\)".*/\1/p')"
  else
    fail "changeset version runs" "$out"
  fi
done

echo "a change to a package domicile does not bundle"
reset @domicile-desktop/e2e-harness
if out="$(version_packages)"; then
  expect "bumps the package" 1.0.1 "$(version_of e2e-harness)"
  expect "leaves domicile alone" 1.0.0 "$(version_of domicile)"
else
  fail "changeset version runs" "$out"
fi

[ "$FAILED" -eq 0 ]
