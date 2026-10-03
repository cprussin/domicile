#!/usr/bin/env bash
# chrome://history, asked for in a browser window.
#
# A page that took a desktop down: HistoryUI looks its tab up unconditionally,
# and a <webview>'s guest is in no tab strip. Patch 0082 refuses a guest every
# page Chrome serves itself. Headless and software-composited like the Escape
# guard.
#
# Its control navigates the same window to an ordinary page instead, which
# must load and must not be refused.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-browser-page.sh
