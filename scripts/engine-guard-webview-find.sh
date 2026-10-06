#!/usr/bin/env bash
# Guard: find in page on a browser window searches the guest, not the shell's
# document, and the element reports the match count.
#
# Headless and software-composited; it reads the count from the browser log.
#
# Control: the same element, guest and pages with no find() call. An <iframe>
# has no find(), so it cannot serve as the control. A count read in the control
# was never requested, which would make the positive count meaningless.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-find.sh
