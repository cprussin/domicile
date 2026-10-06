#!/usr/bin/env bash
# Checks that an extension named only in the compositor's `extensions` message
# is installed and runs: its content script marks a page in a <webview>.
#
# Headless, with a stand-in for the compositor's end of the control socket.
#
# The control runs with an empty list and must leave the page unmarked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-extension-installer.sh
