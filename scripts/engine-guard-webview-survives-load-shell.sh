#!/usr/bin/env bash
# Checks a browser window's page survives `domicile load-shell`. The shell
# opens a window and the engine's command socket loads the shell over itself.
# The page must not reload, must keep running, and the new shell must show it.
#
# Headless and software-composited like the other <webview> guards. It reads
# the browser's log for whether one page kept running.
#
# Control: the same page in the shell's own `<webview src>`, which the reload
# must load again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-survives-load-shell.sh
