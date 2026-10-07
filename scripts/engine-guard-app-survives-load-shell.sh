#!/usr/bin/env bash
# Checks a client's window keeps reaching the page across `domicile
# load-shell`, when the new shell draws its `<app>` at another size.
#
# kitty switches color after the reload, and the new color must reach the page
# at the new box size.
#
# The control never switches kitty's color, and the new color must not appear.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-app-survives-load-shell.sh
