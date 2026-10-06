#!/usr/bin/env bash
# Checks an extension's action in the shell's tray (the `extensions` event,
# with the badge its service worker set) and that its popup in a <webview>
# closes itself as `domicile-close`.
#
# Headless, with a stand-in for the compositor's end of the control socket.
#
# The control runs with an empty list and a page that never closes: the tray
# must still arrive, without the fixture, and the page must not close.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-extension-tray.sh
