#!/usr/bin/env bash
# Checks that a Wayland client's pixels reach the page with the engine on the
# CPU: the path for a card with no 3D.
#
# The engine composites in software, the compositor hands the window over in
# shared memory, and the client draws only in shared memory. See
# docs/architecture/A-DESKTOP-ON-A-TTY.md#software-output. The control runs
# with no client and must fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

SOFTWARE=1 engine_guard_and_control_under_wayland guard-client-window.sh
