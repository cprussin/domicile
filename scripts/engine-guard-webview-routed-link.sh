#!/usr/bin/env bash
# A middle click in a browser window, and the window it asks for.
#
# The other half of what a link can ask for, and the half a page cannot perform
# itself: a middle click asks for the link in a SECOND window, which reaches the
# guest's `OpenURLFromTab`, where content's default delegate answers by doing
# nothing at all — a click with no effect and no error. Patch 0035 is the
# override that makes it a window.
#
# IT READS THE ENGINE'S OWN LINE, not just the element's event.
# `ReportNewWindow` is shared with the `target="_blank"` path that
# `engine-guard-webview-new-window.sh` drives, so a run reading only the
# shell's side would go green against a fork carrying #447 and no override at
# all.
#
# Its control is the SAME POINT ON THE SAME LINK pressed with the left button.
# It must follow the link in the guest and ask the browser for nothing — a run
# where it asks says the claim's run was measuring this guest sending every
# press to its delegate rather than the button. Pressing the same point is what
# stops a geometry error from masquerading as the claim.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-routed-link.sh
