#!/usr/bin/env bash
# Runs `nix flake check`, which evaluates the home-manager module.
#
# `packages/distro/tests/test-the-home-manager-module-agrees.sh` compares options against
# the Rust config struct as text, without nix. Evaluation catches what text
# comparison cannot, such as an option that is declared but never written to
# the config file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
. "$ROOT/packages/distro/lib/nix-check.sh"
require_nix
cd "$ROOT"

# PROBE (draft branch): the runner keeps the tail, so repeat the probe lines last.
rc=0
nix flake check --keep-going --print-build-logs 2>&1 | tee /tmp/flake-check.log || rc=$?
grep -oE 'PROBE .*' /tmp/flake-check.log | grep -v 'print(' | tail -95 || true
exit "$rc"
