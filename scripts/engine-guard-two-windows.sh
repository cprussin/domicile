#!/usr/bin/env bash
# Two clients, two windows, one page — the claim the broker's unit tests cannot
# make for themselves.
#
# They assert that two apps get two sinks. Whether viz then resolves two
# SurfaceDrawQuads in one aggregation is a different question, and a shell is a
# desktop of windows.
#
# Its control is sharper than `client-window`'s, and it is the one that would
# have caught the heuristic this replaced: with a single client running, the
# second canvas must show its own fallback rather than the first client's
# window. A broker that dispatched on nothing would pass the two-client run and
# fail this.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-two-windows.sh
