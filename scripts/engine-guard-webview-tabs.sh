#!/usr/bin/env bash
# An extension's popup asking tabs.query for the active tab, and naming the
# <webview> the shell focused -- every <webview> a tab to chrome.tabs.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the extension-tray guard.
#
# Its control is the same run with the other window focused: the popup must
# name that one, and not the claim's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-tabs.sh
