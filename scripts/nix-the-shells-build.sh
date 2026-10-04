#!/usr/bin/env bash
# Builds both desktops the flake ships.
#
# This covers every vite config, panda codegen step and `^build` dependency of
# the shells.
#
# It also verifies a repin: the build fetches the engine at the url and hash in
# `packages/domicile-engine/engine-release.nix`, so a deleted tag or wrong hash
# fails here. That is why `engine.yml` can exclude that file from its path
# filter, and why `scripts/test-engine-path-filter.sh` requires `nix-build.yml`
# to run on every change.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

nix build --print-build-logs .#manganese .#simple
