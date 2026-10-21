#!/usr/bin/env bash
# Checks a <webview>'s `partition` keeps its storage apart from the user's and
# from other partitions, keeps a `persist:` one across a restart, and keeps any
# other one in memory.
#
# The run writes a key in `persist:guard` and another in `guard`, reads them
# from each partition, from none and from a window opened in `persist:guard`,
# then restarts the engine and reads again. Headless and software-composited.
#
# The control sets no partition: every reader must see both keys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-partition.sh
