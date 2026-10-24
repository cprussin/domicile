#!/usr/bin/env bash
# Guard: a <webview> counts a selector's matches in its page, not the shell's.
# Control: a selector the page has none of counts 0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-count-matches.sh
