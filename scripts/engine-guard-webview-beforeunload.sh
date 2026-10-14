#!/usr/bin/env bash
# Guard: a browser window whose page has a `beforeunload` handler asks the
# shell before it closes. Cancel keeps the page; Leave closes the window.
#
# Control: the press lands on the half of the page that arms nothing. The
# window must close with no dialog, so the positive run's dialog is the
# handler's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-beforeunload.sh
