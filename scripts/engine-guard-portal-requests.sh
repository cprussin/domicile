#!/usr/bin/env bash
# A late listener hears portal requests; only a well-formed answer is relayed.
# See packages/domicile-engine/scripts/guard-portal-requests.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-portal-requests.sh
