#!/usr/bin/env bash
# An extension named only by the compositor's `extensions` message, installed
# by the engine and running: its content script marks a page in a <webview>.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the control-arrival guard.
#
# Its control is the same run with the list empty, which must leave the page
# unmarked -- so the mark is the list's and nothing else's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-extension-installer.sh
