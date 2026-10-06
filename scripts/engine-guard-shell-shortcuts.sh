#!/usr/bin/env bash
# Checks that Chrome's own shortcuts do nothing in a shell that handles none
# of them (patch 0047).
#
# Presses Ctrl+R, F5, Alt+Left, F11, Ctrl+=, Ctrl+W and Ctrl+Shift+Q, which
# would reload, navigate, resize, close or quit. Headless; keys go in over the
# debugging port.
#
# The control reloads the shell over the port instead, to show the guard can
# detect a reload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-shortcuts.sh
