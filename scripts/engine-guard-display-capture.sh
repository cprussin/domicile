#!/usr/bin/env bash
# A display capture through the C ABI reads back what the shell drew, before
# and after a resize.
#
# Headless, no compositor and no client. Its control paints the shell another
# color, which the frames must show instead, so the claim's color is the page
# read back.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-display-capture.sh
