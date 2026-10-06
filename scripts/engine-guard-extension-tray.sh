#!/usr/bin/env bash
# An extension's action in the shell's tray -- `extensions`, with the
# badge its service worker set -- and its popup in a <webview> closing itself
# as `domicile-close`.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# the extension-installer guard.
#
# Its control is the same run with the list empty and a page that never closes:
# the tray must still arrive, without the fixture, and the page must not close.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-extension-tray.sh
