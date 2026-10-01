#!/usr/bin/env bash
# A browser window's find in page, run on the guest rather than on the shell's
# own document, and the count the element holds of what it found.
#
# Headless and software-composited like the other <webview> guards: what this
# reads is the element's own count, out of the browser's own log, so there are
# no pixels and no client. Each step waits for the element to say it landed, so
# a healthy run is seconds; the control is longer, because it watches the steps
# it does not drive.
#
# Its control is not an <iframe>: an <iframe> has no find() at all, so that run
# would end on a TypeError rather than on a reading. This one runs the same
# element, the same guest and the same pages and CALLS NO FIND. Then any count
# it reads is one nobody asked for, and the positive run's need not have been
# the find's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-find.sh
