#!/usr/bin/env bash
# `window.domicile.windows` and `focusedWindow` say what the compositor said,
# to a shell that reads them late. See packages/domicile-engine/scripts/guard-windows-state.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-windows-state.sh
