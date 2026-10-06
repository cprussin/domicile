#!/usr/bin/env bash
# Guard: showSaveFilePicker() in a browser window asks the shell instead of
# drawing a dialog, and the file lands at the path the shell chose.
#
# The guard reads the file from disk. Control: the same save with a shell that
# cancels. The page must see the cancel, and no file may land in the home
# directory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-save-picker.sh
