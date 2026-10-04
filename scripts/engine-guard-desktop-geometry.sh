#!/usr/bin/env bash
# The engine reports the desktop's size and density to the compositor, with no
# help from the page. See packages/domicile-engine/scripts/guard-desktop-geometry.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-desktop-geometry.sh
