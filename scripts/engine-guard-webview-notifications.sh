#!/usr/bin/env bash
# A page in a browser window that may show notifications, with nothing asking
# whether it may — patch 0068, which sets the profile's default to allow.
#
# Headless, no compositor and no client. Its control is two runs of the same
# shell: a guest that paints unasked, which MUST show, then one asking about a
# permission nothing granted, which must NOT — so the claim's color is the
# default and not a page that paints whatever it is told.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-notifications.sh
