#!/usr/bin/env bash
# Checks that an extension's windows.create({type: "popup"}) opens a browser
# window the shell draws with `<webview window>`, and windows.remove closes it.
#
# Headless, with a stub for the compositor's end of the control socket, like
# the extension-tray guard.
#
# Control: the same page in a window the shell opened. It must be a tab of the
# shell's own window, and windows.remove must fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-popup-window.sh
