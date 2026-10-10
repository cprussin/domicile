#!/usr/bin/env bash
# Checks that a client's buffer drawn with wl_surface.set_buffer_transform is
# shown upright.
#
# The control draws the same buffer unturned: its halves must sit side by side
# rather than stacked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-buffer-transform.sh
