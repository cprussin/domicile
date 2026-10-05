#!/usr/bin/env bash
# A chord grabbed by name is resolved by the engine and comes back by name.
# See packages/domicile-engine/scripts/guard-shortcut-chords.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-shortcut-chords.sh
