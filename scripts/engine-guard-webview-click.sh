#!/usr/bin/env bash
# Checks that the shell hears about a click inside a browser window, so it can
# raise the window.
#
# Upstream sends no focus event across a remote frame's process boundary;
# patch 0011 has the element report it. The click goes in over the debugging
# port.
#
# The control clicks the shell's own UI instead of the window. An <iframe>
# control would not work: a same-process frame's focus does reach its owner.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-click.sh
