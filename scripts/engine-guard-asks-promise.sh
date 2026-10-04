#!/usr/bin/env bash
# An ask resolves with its own answer; a newer one rejects the older.
# See packages/domicile-engine/scripts/guard-asks-promise.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-asks-promise.sh
