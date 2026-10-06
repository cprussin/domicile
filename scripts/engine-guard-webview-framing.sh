#!/usr/bin/env bash
# Guard: a <webview> shows a site that refuses framing (X-Frame-Options,
# frame-ancestors).
#
# Headless and software-composited; it reads the page's own colors.
#
# Control: two <iframe> runs on an http page. The first frames a copy of the
# site that permits framing and must show it. The second frames the copy that
# refuses and must show nothing. The copies differ only in those headers, so
# the pair proves the harness can draw a framed page and the refusal is real.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-framing.sh
