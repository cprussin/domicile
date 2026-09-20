#!/usr/bin/env bash
# What a target="_blank" link in a browser window does, which until recently
# was nothing at all.
#
# The browser refuses the window a guest asks for — it has no SiteInstance of
# its own, and content CHECKs that pair — so the address is reported instead
# and the shell opens a browser window of its own. The guard clicks the link
# and reads the page that arrives in the SECOND <webview>, because an event is
# not a window.
#
# Its control is the other half of the same page, which is an ordinary link in
# the same guest clicked the same way. It must navigate the window it is in and
# ask for no second one — a run where it asks anyway is a run where the element
# announces a window for any click or any navigation, which would pass the
# claim while measuring nothing about the target.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-new-window.sh
