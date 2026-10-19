#!/usr/bin/env bash
# Tests that `distro/shell-workspace.sh modules` lays out the same tree
# whatever the workspace packages' versions are.
#
# `flake.nix` builds that tree as a fixed-output derivation, so a version in it
# would change its hash on every "Version packages" pull request.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_WORKSPACE="$ROOT/distro/shell-workspace.sh"
BUN="$(command -v bun)" || { echo "SKIP: no bun"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# The manifests and lockfile `modules` reads, as `workspaceManifests` in
# `flake.nix` holds them.
manifests() { # out
  mkdir -p "$1/packages"
  cp "$ROOT/package.json" "$ROOT/bun.lock" "$ROOT/bunfig.toml" "$1/"
  for manifest in "$ROOT"/packages/*/package.json; do
    package="$(basename "$(dirname "$manifest")")"
    mkdir -p "$1/packages/$package"
    cp "$manifest" "$1/packages/$package/"
  done
}

# Runs `modules` on <workspace> into <out>.
modules() { # workspace, out
  HOME="$WORK/home" bash "$SHELL_WORKSPACE" modules "$BUN" "$1" "$2" >"$WORK/log" 2>&1 ||
    { fail "modules runs" "$(tail -20 "$WORK/log")"; return 1; }
  # As `shellModules` in `flake.nix`: bun links these at random.
  find "$2/node_modules/.bun" -mindepth 3 -maxdepth 3 \
    -type d -path '*/node_modules/.bin' -exec rm -rf {} +
}

echo "a version bump"
manifests "$WORK/tree"
manifests "$WORK/bumped"
for manifest in "$WORK"/bumped/packages/*/package.json; do
  jq '.version = "1.2.3"' "$manifest" >"$manifest.next"
  mv "$manifest.next" "$manifest"
done
(cd "$WORK/bumped" && HOME="$WORK/home" "$BUN" install --lockfile-only >"$WORK/log" 2>&1) ||
  fail "the bumped lockfile installs" "$(tail -20 "$WORK/log")"

if modules "$WORK/tree" "$WORK/tree-out" && modules "$WORK/bumped" "$WORK/bumped-out"; then
  if differences="$(diff -r --no-dereference "$WORK/tree-out" "$WORK/bumped-out" 2>&1)"; then
    ok "leaves the modules unchanged"
  else
    fail "leaves the modules unchanged" "$(head -20 <<<"$differences")"
  fi
fi

[ "$FAILED" -eq 0 ]
