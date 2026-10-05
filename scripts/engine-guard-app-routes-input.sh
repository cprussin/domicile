#!/usr/bin/env bash
# An `<app>` sends its client what lands on it, in the client's surface
# coordinates, with nothing on the page routing it; its control draws `<div>`s
# in the `<app>`s' place and must send nothing. See
# packages/domicile-engine/scripts/guard-app-routes-input.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-app-routes-input.sh
