#!/usr/bin/env bash
# Install, type-check and build `examples/minimal-shell` from npm, with its
# manifest as committed.
#
#   .github/scripts/example-shell-from-npm.sh
#
# `scripts/test-out-of-tree-shell.sh` swaps the SDK for a local tarball, so it
# cannot see a dependency npm does not have. This copies the example out of the
# repo untouched and installs from the registry. It needs the network, so it
# runs in example-shell.yml rather than `./scripts/check.sh`.
#
# Ordering: the example pins `0.0.0-alpha-<sha>`, which publish-packages.yml
# published when <sha> landed on main. So the pin may only name a commit that
# is already on main and on `stable`; this checks both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXAMPLE="$ROOT/examples/minimal-shell"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SHELL_DIR="$WORK/minimal-shell"
cp -R "$EXAMPLE" "$SHELL_DIR"
rm -rf "$SHELL_DIR/node_modules" "$SHELL_DIR/.vite"

(
  cd "$SHELL_DIR"
  bun install
  cmp package.json "$EXAMPLE/package.json"
  echo "PASS: the committed manifest installs from npm"
  bunx tsc --noEmit
  echo "PASS: it type-checks"
  bun run build
  test -f .vite/renderer/main_window/shell.js
  echo "PASS: it builds .vite/renderer/main_window/shell.js"
)

sdk="$(jq -r '.dependencies["@domicile-desktop/sdk"]' "$EXAMPLE/package.json")"
sha="${sdk#0.0.0-alpha-}"

# `stable` is the release the README recommends running the example on.
git -C "$ROOT" fetch -q origin +refs/heads/stable:refs/remotes/origin/stable
commit="$(git -C "$ROOT" rev-parse --verify -q "$sha^{commit}")" || {
  echo "FAIL: the SDK version $sdk names no commit in this repository" >&2
  exit 1
}
git -C "$ROOT" merge-base --is-ancestor "$commit" refs/remotes/origin/stable || {
  echo "FAIL: ${commit:0:12} is not on stable, so its engine may not be the official one" >&2
  exit 1
}
echo "PASS: $sdk is from ${commit:0:12}, which stable has"

