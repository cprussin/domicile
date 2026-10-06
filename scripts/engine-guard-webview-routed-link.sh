#!/usr/bin/env bash
# Guard: a middle click on a link in a browser window opens a second window.
#
# A middle click reaches the guest's `OpenURLFromTab`, where content's default
# delegate does nothing. Patch 0035 overrides it to request a window.
#
# The guard reads the engine's own log line as well as the element's event.
# `ReportNewWindow` is shared with the target="_blank" path
# (`engine-guard-webview-new-window.sh`), so the event alone would pass without
# the override.
#
# Control: a left click on the same point of the same link. It must navigate
# in the guest and request nothing. A request here would mean the guest sends
# every press to its delegate. Using the same point rules out a geometry error.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-routed-link.sh
