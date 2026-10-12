#!/usr/bin/env bash
# Guard: a page in a browser window opens a `prompt()`, the shell is asked,
# and its answer reaches the page.
#
# Control: the press lands on the half of the page that opens nothing.
# Nothing may be reported, so the positive run's report is the dialog's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-dialog.sh
