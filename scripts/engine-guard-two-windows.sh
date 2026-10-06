#!/usr/bin/env bash
# Checks that two clients show two windows on one page.
#
# The broker's unit tests check for two sinks; this checks that viz draws two
# SurfaceDrawQuads in one aggregation.
#
# The control runs one client: the second canvas must show its fallback, not
# the first client's window. A broker that ignored the app id would fail it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-two-windows.sh
