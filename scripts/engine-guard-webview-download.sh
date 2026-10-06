#!/usr/bin/env bash
# Checks that a download in a browser window asks the shell for a path and
# lands there.
#
# The control uses a shell that cancels: no file may land in the home.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-download.sh
