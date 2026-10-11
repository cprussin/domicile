#!/usr/bin/env bash
# Guard: a page in a browser window asks for a device through WebHID, the
# shell is asked, and its answer reaches the page.
#
# Control: the press lands on the half of the page that asks for nothing.
# Nothing may be reported, so the positive run's report is the request's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-device-request.sh
