#!/usr/bin/env bash
# Checks an app module runs: `run_app` opens its window, its `main` gets a
# DomicileAppHost, and its system call reaches the compositor as an app's.
# See docs/architecture/APP-MODULES.md.
#
# Control: the app's address opened in a window no app was opened in, which
# must not run it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-app-module.sh
