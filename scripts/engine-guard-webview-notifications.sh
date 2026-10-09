#!/usr/bin/env bash
# Guard: a page in a browser window must ask before it notifies. Patch 0104
# resets the profile's default to ask.
#
# Headless, with no compositor or client. Control: two runs of the same shell.
# A guest that paints unconditionally must show; a guest that asks about a
# permission seeded to allow must not. This proves the claim's color comes from
# the reset.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-notifications.sh
