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

# NEVER MERGE: only the resize-freeze repro checks.
rc=0
nix build --keep-going --print-build-logs --no-link \
  .#checks.x86_64-linux.resize-freeze-repro-1 .#checks.x86_64-linux.resize-freeze-repro-2 \
  .#checks.x86_64-linux.resize-freeze-repro-3 .#checks.x86_64-linux.resize-freeze-repro-4 \
  2>&1 | tee /tmp/flake-check.log || rc=$?
grep -E 'REPRO[0-9]' /tmp/flake-check.log | sed -E 's/^.*(REPRO[0-9])/\1/' | cut -c1-3000 | tail -95
exit $rc
