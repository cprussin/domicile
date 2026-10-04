#!/usr/bin/env bash
# Guard: a target="_blank" link in a browser window opens a second browser
# window in the shell.
#
# The browser refuses the guest's window request (a guest has no SiteInstance
# of its own, and content CHECKs that), so it reports the URL and the shell
# opens the window. The guard clicks the link and reads the page in the second
# <webview>, since the event alone does not prove a window opened.
#
# Control: an ordinary link in the same guest, clicked the same way. It must
# navigate in place and request no window. A request here would mean the
# element announces a window for any navigation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-new-window.sh
