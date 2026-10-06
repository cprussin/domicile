#!/usr/bin/env bash
# Guard: an extension popup's tabs.query for the active tab names the
# <webview> the shell focused. Every <webview> is a tab to chrome.tabs.
#
# Headless, with a stand-in for the compositor's end of the control socket.
#
# Control: the same run with the other window focused. The popup must name
# that window.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-tabs.sh
