#!/usr/bin/env bash
# Guard: a page in a browser window may show notifications without a prompt.
# Patch 0068 sets the profile's default to allow.
#
# Headless, with no compositor or client. Control: two runs of the same shell.
# A guest that paints unconditionally must show; a guest that checks a
# permission nothing grants must not. This proves the claim's color comes from
# the default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-notifications.sh
