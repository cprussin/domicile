#!/usr/bin/env bash
# What an `<input type="file">` in a browser window does: asks the shell, and
# hands the page the file the shell picked.
#
# The guard clicks the input and reads the file's contents back out of the
# page, because a name is not a file the renderer was allowed to read. Its
# control is the same click with a shell that cancels: the page must get no
# file and must hear the cancel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-upload.sh
