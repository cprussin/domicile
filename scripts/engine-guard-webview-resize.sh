#!/usr/bin/env bash
# Checks a browser window still draws and takes presses after a burst of
# resizes. The shell resizes the window's `<webview>` many times, then a press
# in the window must reach the page and the screen must show its next frame.
#
# Headless and software-composited like the other <webview> guards.
#
# Control: the same steps with nothing resized.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-resize.sh
