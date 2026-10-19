#!/usr/bin/env bash
# A domicile:// document fetches its own files, and no web page reads them.
# See packages/domicile-engine/scripts/guard-domicile-fetch.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-domicile-fetch.sh
