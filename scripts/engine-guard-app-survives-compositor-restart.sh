#!/usr/bin/env bash
# Checks a shell keeps its page, its `<app>` and its watch across a compositor
# restart under the same engine.
#
# The next compositor's client draws a new color, and it must reach the kept
# `<app>`; the shell must hear its window close, its watch end and the touch
# after it watches again.
#
# The control's next client draws the first color, and the new color must not
# appear.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-app-survives-compositor-restart.sh
