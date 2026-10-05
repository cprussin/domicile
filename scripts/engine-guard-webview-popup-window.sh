#!/usr/bin/env bash
# An extension's windows.create({type: "popup"}) opens a desk browser window.
# Its page is the popup window's tab, the shell draws it with
# `<webview window>`, and its windows.remove closes it.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the extension-tray guard.
#
# Control: the same page in a window the shell opened. Its page must be a tab
# of the desk's own window and be refused the remove.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-popup-window.sh
