#!/usr/bin/env bash
# A click in the shell's tray granting an extension activeTab on the focused
# <webview>: the extension's scripting.executeScript paints it, with no host
# permission of its own.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the extension-installer guard.
#
# Its control is the same run with no click: the page must stay unpainted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-active-tab.sh
