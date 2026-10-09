#!/usr/bin/env bash
# Guard: the link under the pointer in a browser window reaches the shell as
# `targetUrl`, clears when the pointer leaves the page, and returns when it
# comes back.
#
# Control: the pointer moves only on the shell's strip. Nothing may be
# reported, so the positive run's report is the hover's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-target-url.sh
