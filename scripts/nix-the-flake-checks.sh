#!/usr/bin/env bash
# `nix flake check`, which is where the home-manager module is evaluated.
#
# `scripts/test-the-home-manager-module-agrees.sh` compares the module's
# options against the Rust config struct textually, because there is no nix in
# every session that needs to run it. That is the half that needs no nix. This
# is the other half: a module that declares an option it then fails to write
# into the config file is a mismatch no text comparison sees, and evaluating it
# against a real configuration is what catches it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

nix flake check --print-build-logs
