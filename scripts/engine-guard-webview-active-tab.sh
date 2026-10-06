#!/usr/bin/env bash
# Checks that a click in the shell's tray grants an extension activeTab on the
# focused <webview>: its scripting.executeScript paints the page without host
# permissions.
#
# Headless, with a stand-in for the compositor's end of the control socket.
#
# The control runs with no click: the page must stay unpainted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-active-tab.sh
