#!/usr/bin/env bash
# Guard: a page in a browser window goes fullscreen from its own button, the
# shell hears it as `pageFullscreen`, and Escape and `exitPageFullscreen()`
# each take it out.
#
# Control: the press lands on the half of the page that asks for nothing.
# Nothing may be reported, so the positive run's report is the request's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-fullscreen.sh
