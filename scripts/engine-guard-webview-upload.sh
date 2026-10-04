#!/usr/bin/env bash
# Guard: an `<input type="file">` in a browser window asks the shell and gives
# the page the file the shell picked.
#
# The guard reads the file's contents back from the page, since a name alone
# does not prove the renderer could read it. Control: the same click with a
# shell that cancels. The page must get no file and must see the cancel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-upload.sh
