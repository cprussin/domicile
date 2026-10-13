#!/usr/bin/env bash
# Guard: the engine starts the Settings app's native messaging host for the
# app, and the host reads the config the desktop names.
# Control: an extension without the app's key is refused.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-settings-host.sh
