#!/usr/bin/env bash
# Checks that a Wayland client's pixels reach the page.
#
# A client draws a color, the compositor submits its buffer to the engine, and
# the test reads back the page's canvas. The control runs with no client and
# must fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-client-window.sh
