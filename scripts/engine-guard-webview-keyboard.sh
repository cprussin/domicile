#!/usr/bin/env bash
# A desktop chord pressed while a browser window holds the keyboard.
#
# The other half of what a guest is for, which the framing guard does not
# touch. Headless and software-composited for the same reason it is: nothing
# here is measured in pixels, so no GPU and no nested compositor are needed.
# The keystroke goes in over the debugging port, which is the only keyboard
# this machine has; `guard-webview-keyboard-key.py` sets out why that is the
# same path a real key takes rather than a way around it.
#
# Its control is the sharp kind the framing guard has: an <iframe> in the
# element's place, pointed at the same page. It takes the keyboard just as
# thoroughly — that is the defect this fixes, not the guest — and there is no
# guest delegate behind it, so NOTHING may fire. A run where the chord arrives
# here is a run where the press did not come from the hook under test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-keyboard.sh
