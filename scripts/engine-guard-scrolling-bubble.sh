#!/usr/bin/env bash
# Checks that a bubble moves in the same display frame as its window's
# content: each frame of a monitor cast shows a sync bubble at the stripe its
# window scrolls.
#
# The control runs a page that does not sync frames: the bubble must be off
# its stripe in some frame.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-scrolling-bubble.sh
