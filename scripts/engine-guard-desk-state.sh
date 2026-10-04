#!/usr/bin/env bash
# The desk's state attributes on `window.domicile` say what the compositor
# said, to a shell that reads them late. See packages/domicile-engine/scripts/guard-desk-state.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-desk-state.sh
