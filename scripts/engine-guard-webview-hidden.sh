#!/usr/bin/env bash
# Checks a browser window's page is hidden while its `<webview>` is not
# rendered, visible once it is, and hidden again after.
#
# Headless and software-composited like the other <webview> guards. It reads
# the page's `document.visibilityState` from the browser's log.
#
# Control: the same window in a box shown from the start, whose page must be
# visible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-hidden.sh
