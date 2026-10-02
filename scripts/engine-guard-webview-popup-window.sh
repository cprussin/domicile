#!/usr/bin/env bash
# An extension's windows.create({type: "popup"}) opened by the shell as a
# window of its own: the <webview> naming it in `popupwindow` is its tab, and
# its windows.remove reaches the shell as `domicile-close`.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the extension-tray guard.
#
# Its control opens the same <webview> without `popupwindow`: its page must be
# a tab of the desk's own window, and windows.create must not answer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-popup-window.sh
