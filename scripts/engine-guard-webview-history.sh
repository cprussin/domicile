#!/usr/bin/env bash
# Guard: back, forward, stop and reload on a browser window act on the guest.
#
# Headless and software-composited; it reads the order of the pages the guest
# showed from the browser log.
#
# Control: the same element, guest and navigations with none of the four
# calls. An <iframe> has no goBack(), so it cannot serve as the control. A
# third page appearing would mean the guest goes back on its own. The slow page
# arriving shows that its absence in the positive run is due to stop().
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-history.sh
