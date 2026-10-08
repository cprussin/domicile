#!/usr/bin/env bash
# Checks a private <webview> and a private browser window keep their cookies
# apart from the user's.
#
# The run sets a cookie in a `<webview private>`: a private reader and a
# private window see it, an ordinary reader does not. Headless and
# software-composited.
#
# The control sets it in an ordinary <webview>: the private reader must not
# see it, and the window must not be listed as private.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-private.sh
