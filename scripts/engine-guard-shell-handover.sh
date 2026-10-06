#!/usr/bin/env bash
# The engine runs the shell and hands it the desktop; no global holds it.
# See packages/domicile-engine/scripts/guard-shell-handover.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-shell-handover.sh
