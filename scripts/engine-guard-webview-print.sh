#!/usr/bin/env bash
# Guard: a browser window's page prints through the system print dialog, from
# the shell's `print()` and from the page's own `window.print()`.
#
# Control: the shell never calls `print()`. The page must see no print, so the
# positive run's prints are `print()`'s.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-print.sh
