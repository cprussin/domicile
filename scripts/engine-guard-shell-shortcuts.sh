#!/usr/bin/env bash
# Chrome's own shortcuts, pressed at a shell that handles none of them.
#
# Ctrl+R, F5, Alt+Left, F11, Ctrl+=, Ctrl+W and Ctrl+Shift+Q, each of which
# Chrome acted on before patch 0047: reloading, navigating, resizing, closing or
# quitting the desktop. Headless, and the keys go in over the debugging port
# like the webview guards'.
#
# Its control reloads the shell over that port where the chords would have
# gone, because the claim is an absence and a guard that cannot read a reload
# the browser made cannot read one a key caused either.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-shortcuts.sh
