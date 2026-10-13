#!/usr/bin/env bash
# Checks the flake's bun satisfies `engines.bun` in `package.json`.
#
# The flake's bun runs the builder, the shell builds and the dev shell, and
# `distro/build.sh` ships its source. CI's TypeScript checks run the bun
# `packageManager` names, so a stale flake bun fails only for Nix users.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

bun="$(nix build --no-link --print-out-paths .#bun^out)/bin/bun"

# The shipped bun judges itself, with the semver rules bun reads `engines` by.
"$bun" --eval '
  const wanted = (await Bun.file("package.json").json()).engines.bun;
  if (!Bun.semver.satisfies(Bun.version, wanted)) {
    console.error(`the flake ships bun ${Bun.version}; package.json asks for ${wanted}`);
    process.exit(1);
  }
  console.log(`the flake ships bun ${Bun.version}, which satisfies ${wanted}`);
'
