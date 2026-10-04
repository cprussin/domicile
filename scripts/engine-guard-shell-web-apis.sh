#!/usr/bin/env bash
# Checks that the shell's page can show a notification and read a response
# another origin shares via CORS, as a bar widget needs.
#
# Headless, with no compositor or client. The control is two runs: a box
# painted without a request must show, and one waiting on an origin that
# shares nothing must not. So the color comes from CORS, not from a fetch that
# reads anything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-web-apis.sh
