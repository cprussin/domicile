#!/usr/bin/env bash
# What a download in a browser window does: asks the shell where it goes, and
# lands there.
#
# The guard clicks a download link and reads the file off the disk at the path
# the shell chose. Its control is the same download with a shell that cancels:
# nothing may land anywhere in the home.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-download.sh
