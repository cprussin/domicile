#!/usr/bin/env bash
# Checks that shell-simple on the fork shows a real client's window.
#
# Other guards drive pages written for them. This one covers the shell's vite
# build, its connection to the compositor through `Shell`, and mounting an
# `<app>` for a window the host announced.
#
# Asserts the client's color appears anywhere in the window, since the shell's
# CSS decides window placement.
#
# The control runs with the client drawing a different color. A run with no
# client would pass vacuously because the probe runs only when a client
# commits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shell.sh
