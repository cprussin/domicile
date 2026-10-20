#!/usr/bin/env bash
# Checks a <webview>'s `domicile-will-navigate` asks the shell before its page
# navigates itself, and that canceling it keeps the page where it is.
#
# The page navigates to /blocked, which the shell cancels, then to /allowed.
# The shell's own `src` must not ask. Headless and software-composited.
#
# The control cancels nothing: /blocked must be requested.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-will-navigate.sh
