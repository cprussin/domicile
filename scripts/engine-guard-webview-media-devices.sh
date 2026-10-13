#!/usr/bin/env bash
# Guard: a <webview> lists the fake cameras, and preferring one puts it first.
# Control: an id no camera has is refused and the order stays.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-media-devices.sh
