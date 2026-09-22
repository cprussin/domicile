#!/usr/bin/env bash
# A click inside a browser window, and the shell hearing about it.
#
# The pointer's half of the boundary the keyboard guard measures, and a shell
# has to hear about it because clicking a window is what raises it. Upstream
# dispatches no focus event across a remote frame's process boundary, and
# focusing the element across it dispatches none either — patch 0011 says why,
# and has the element speak for itself instead. The press goes in over the
# debugging port, which is the only pointer this machine has.
#
# Its control is neither of the other two's: an <iframe> in the element's place
# would be same-process and about:blank, and a same-process frame's focus DOES
# reach its owner — so a control built that way would fire every time and
# decide nothing. This one clicks the shell's own chrome instead of the window
# below it. A run where the element is reached anyway is a run where the
# positive reading was the attach, the load, or the configuration, and not the
# click.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-click.sh
