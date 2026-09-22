#!/usr/bin/env bash
# A browser window's back, forward, stop and reload, driven at the guest rather
# than at the placeholder frame they used to reach.
#
# Headless and software-composited like the other <webview> guards: what this
# reads is the ORDER of the pages a guest showed, out of the browser's own log,
# so there are no pixels and no client. It is slower than either — the schedule
# is a minute and a half, because every step of it is a timer and the element
# fires no navigation event to wait on instead.
#
# Its control is not the <iframe> the other two use: an <iframe> has no
# goBack() at all, so that run would end on a TypeError rather than on a
# reading. This one runs the same element, the same guest and the same
# navigations and CALLS NONE OF THE FOUR. Then a third page appearing means a
# guest moves back on its own — and the positive run's third page need not have
# been goBack() — and the slow page arriving is what makes the positive run's
# not showing it a measurement of stop().
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-history.sh
