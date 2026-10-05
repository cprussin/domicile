#!/usr/bin/env bash
# A `focusrequested` sent before the shell listens reaches its first listener.
# See packages/domicile-engine/scripts/guard-held-moments.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-held-moments.sh
