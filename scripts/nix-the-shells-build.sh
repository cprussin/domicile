#!/usr/bin/env bash
# Both desktops the flake ships, built.
#
# The broadest thing in the `nix` group and the one that catches the most: a
# shell is a built web page, so this reaches every vite config, every panda
# codegen step and the whole `^build` edge from `@domicile/chrome-sdk`.
#
# AND IT IS WHAT PROVES A REPIN. `nix build .#manganese .#simple` reaches
# `domicileEngine`, which is `fetchurl` of exactly the url and hash in
# `packages/domicile-engine/engine-release.nix` — so a tag that was deleted or
# a hash off by a byte fails here, in three minutes, on a runner nobody is
# waiting for. That is the whole of what a repin needs asserting, and it is why
# `engine.yml` is allowed to exclude that file from its path filter and why
# `scripts/test-engine-path-filter.sh` fails if `nix-build.yml` ever stops
# running on everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

nix build --print-build-logs .#manganese .#simple
