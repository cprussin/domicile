#!/usr/bin/env bash
# Checks an app window, opened as `domicile open-app` opens one, is listed
# with `isApp` and records no visits.
#
# The run opens the subject page as an app window, then a sentinel page as an
# ordinary one: the sentinel is recorded, the subject is not. Headless and
# software-composited.
#
# The control opens the subject as an ordinary window: it must be recorded and
# not listed as an app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-app-window.sh
