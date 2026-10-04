#!/usr/bin/env bash
# Runs guard-webview-activate.sh and its control: a browser window's page
# brought to the front fires `domicile-focus-request`; the shell's own does not.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-activate.sh
