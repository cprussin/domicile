#!/usr/bin/env bash
# What a file dialog in a browser window does: asks the shell instead of
# drawing, and the page's file lands where the shell said.
#
# The guard presses a button that calls showSaveFilePicker() and reads the file
# off the disk at the path the shell chose. Its control is the same save with a
# shell that cancels: the page must be told, and nothing may land anywhere in
# the home.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-save-picker.sh
