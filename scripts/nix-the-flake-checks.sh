#!/usr/bin/env bash
# Runs `nix flake check`, which evaluates the home-manager module.
#
# `scripts/test-the-home-manager-module-agrees.sh` compares options against
# the Rust config struct as text, without nix. Evaluation catches what text
# comparison cannot, such as an option that is declared but never written to
# the config file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

nix flake check --print-build-logs
