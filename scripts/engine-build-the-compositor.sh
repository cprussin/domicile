#!/usr/bin/env bash
# Builds the compositor that the guards run.
#
# The guards only check for the binary, and the `crux` runner deletes its work
# directory on every start. A check, not a workflow step, so `check.sh engine`
# works the same for a person on `crux` as in CI.
#
# Building `domicile-compositor` also builds `domicile-test-client`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"

# Requires the tree like every check in the group, so a machine without one
# skips this too.
require_engine_out

cd "$ROOT"
# CI's checkout wipes `target/` every run; a kept one makes this incremental.
# Per runner, so no run's guards read a binary another run just rebuilt.
if [ -n "${DOMICILE_CARGO_TARGET:-}" ] && { [ -L target ] || [ ! -e target ]; }; then
  mkdir -p "$DOMICILE_CARGO_TARGET"
  ln -sfn "$DOMICILE_CARGO_TARGET" target
fi
cargo build -p domicile-compositor
