#!/usr/bin/env bash
# Checks that chrome://history in a browser window is refused.
#
# HistoryUI assumes a tab, and a <webview> guest has none, so it crashes the
# desktop. Patch 0083 refuses guests every page Chrome serves itself. Headless
# and software-composited.
#
# The control navigates to an ordinary page, which must load.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-browser-page.sh
