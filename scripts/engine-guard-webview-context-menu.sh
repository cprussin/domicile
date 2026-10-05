#!/usr/bin/env bash
# A right click in a browser window, the menu the shell is handed for it, and
# DevTools opened from that menu in a window the shell draws.
#
# The browser draws no context menu over a desktop, so the guest hands what
# Chrome's menu is built from to the element and the shell draws one. This
# reads the menu the shell is handed and the one item that crosses every
# layer on the way back: "inspect", which asks the shell for a window at
# DevTools' address, and the browser's own line that DevTools attached in the
# <webview> the shell opened there.
#
# Its control serves the same page with its own `contextmenu` canceled -- a
# site drawing its own menu -- and the shell must hear nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-context-menu.sh
