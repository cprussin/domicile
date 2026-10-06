#!/usr/bin/env bash
# The shell document runs script only from the shell root.
# See packages/domicile-engine/scripts/guard-shell-script-src.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-shell-script-src.sh
