#!/usr/bin/env bash
# Guard: a page in a browser window opens a window with `window.open()`, gets
# a handle, and the window and its opener script each other.
#
# Control: the press lands on the half of the page that opens nothing.
# Nothing may be reported, so the positive run's report is window.open()'s.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-window-open.sh
