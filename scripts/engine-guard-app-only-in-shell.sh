#!/usr/bin/env bash
# <app> exists in the shell and in no web page.
# See packages/domicile-engine/scripts/guard-app-only-in-shell.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-app-only-in-shell.sh
