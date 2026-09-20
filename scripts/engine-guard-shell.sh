#!/usr/bin/env bash
# A shell on the fork, showing a real client's window — what all of it is for.
#
# Every other guard drives a page written for the guard. This one drives
# shell-simple, built by its own vite config, joined to the compositor by the
# SDK's own `connectToHost` over a WebSocket to the bridge serving it, and
# mounting an `<app>` for a window it learned about from the host. Three things
# that have each failed on their own, and none of which any other guard
# touches.
#
# It asserts that the client's color is somewhere in the browser's window
# rather than at a point, because the shell decides where its windows go and a
# coordinate here would be asserting shell-simple's CSS.
#
# Its control is the same run with the client drawing a different color. Not
# "no client", because the probe only runs when a client commits, so a run with
# nothing to submit would pass while measuring nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shell.sh
