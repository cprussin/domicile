#!/usr/bin/env bash
# Checks that a <webview> whose page's renderer crashes tells the shell why,
# draws nothing while the page is gone, and comes back on reload() (patch
# 0124).
#
# Headless and software-composited like the other <webview> guards. It reads
# the shell's lines from the browser's log and the view's pixels over the
# debugging port.
#
# Control: the same page left alone, which must report nothing and stay drawn.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-crash.sh
