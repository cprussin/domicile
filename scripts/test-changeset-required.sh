#!/usr/bin/env bash
# Tests `.github/scripts/changeset-required.sh`, which fails a branch that
# changes a workspace package without a changeset.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REQUIRED="$ROOT/.github/scripts/changeset-required.sh"
[ -x "$REQUIRED" ] || { echo "no $REQUIRED" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A workspace with one package on `main`, and a branch `change` off it.
reset() {
  rm -rf "$WORK/repo"
  mkdir -p "$WORK/repo/packages/a" "$WORK/repo/.changeset" "$WORK/repo/scripts"
  cd "$WORK/repo"
  printf '{"name":"root","private":true,"workspaces":["packages/*"]}\n' >package.json
  printf '{"lockfileVersion":1,"workspaces":{}}\n' >bun.lock
  printf '{"name":"a","version":"1.0.0"}\n' >packages/a/package.json
  cp "$ROOT/.changeset/config.json" .changeset/
  ln -s "$ROOT/node_modules" node_modules
  git init -q -b main
  git add -A
  git -c user.name=t -c user.email=t@t commit -qm base
  git checkout -qb change
}

commit() {
  git add -A
  git -c user.name=t -c user.email=t@t commit -qm change
}

# Expects the check to pass (0) or fail (1) on the branch.
expect() { # what, want
  status=0
  out="$("$REQUIRED" main 2>&1)" || status=1
  if [ "$status" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "exit $status: $out"
  fi
}

echo "a change to a package"
reset
echo 'export {};' >packages/a/index.js
commit
expect "without a changeset fails" 1
printf -- '---\n"a": patch\n---\n\nA change.\n' >.changeset/a-change.md
commit
expect "with a changeset passes" 0

echo "a change to a package that releases nothing"
reset
echo 'export {};' >packages/a/index.js
printf -- '---\n---\n' >.changeset/no-release.md
commit
expect "with an empty changeset passes" 0

echo "a change outside the packages"
reset
echo 'echo hi' >scripts/hi.sh
commit
expect "needs no changeset" 0

# `bun install` marks each `bin` executable. changesets compares the working
# tree, so a bin tracked without the mode reads as a changed package in CI.
echo "the workspace's bins"
cd "$ROOT"
for manifest in packages/*/package.json; do
  for bin in $(jq -r '(.bin // {}) | if type == "string" then . else .[] end' "$manifest"); do
    path="$(dirname "$manifest")/${bin#./}"
    mode="$(git ls-files -s "$path" | cut -d' ' -f1)"
    if [ "$mode" = 100755 ]; then
      ok "$path is tracked executable"
    else
      fail "$path is tracked executable" "mode $mode"
    fi
  done
done

[ "$FAILED" -eq 0 ]
