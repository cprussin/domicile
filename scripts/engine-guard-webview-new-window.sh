#!/usr/bin/env bash
# Guard: a target="_blank" form in a browser window opens a second browser
# window in the shell, with the form's POST.
#
# Content makes the guest's new window through CreateNewGuestWindow (patch
# 0115), and the browser lists it for the shell. The guard sends the form and
# reads the page in the second <webview>, since the event alone does not prove
# a window opened.
#
# Control: an ordinary link in the same guest, clicked the same way. It must
# navigate in place and request no window. A request here would mean the
# element announces a window for any navigation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-new-window.sh
