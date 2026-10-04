#!/usr/bin/env bash
# Guard: a desktop chord pressed while a browser window has keyboard focus
# reaches the shell.
#
# Headless and software-composited; nothing is measured in pixels. The key goes
# in over the debugging port; `guard-webview-keyboard-key.py` explains why that
# takes the same path as a real key.
#
# Control: an <iframe> in the element's place, on the same page. It also takes
# the keyboard but has no guest delegate, so no chord may fire. A chord here
# means the positive press did not come from the hook under test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-keyboard.sh
