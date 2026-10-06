#!/usr/bin/env bash
# Checks the `manganese` shell, which builds differently from `simple`: it
# consumes a component library as source with its own panda codegen.
#
# It needs its own control. `engine found` matches one pixel of the color
# anywhere in the window, so the control shows that this page does not paint
# that color itself, and manganese's tokens could.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shell.sh manganese
