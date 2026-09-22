#!/usr/bin/env bash
# A <webview> showing a site that refuses to be framed — the one thing patch
# 0007 said it could not do.
#
# No nested compositor and no client: the colors this looks for are a page's
# own, so headless and software-composited is the whole environment it needs.
#
# Its control is two runs rather than one: an <iframe> on an ordinary http page
# framing a copy of the site that permits framing, which MUST show it, and then
# the same frame on the same page framing the copy that refuses, which must
# show NOTHING. The two copies differ only in X-Frame-Options and
# frame-ancestors, so the difference between the runs is a reading of those
# headers — where a run that only ever measured an absence cannot tell "the
# site is refused" from "this harness cannot draw a framed page at all". The
# positive run cannot tell those apart from the inside either, which is why the
# control exists.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-framing.sh
