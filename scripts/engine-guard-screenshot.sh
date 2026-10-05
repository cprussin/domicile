#!/usr/bin/env bash
# `domicile screenshot`'s engine half writes a PNG of what the shell drew.
#
# Headless, no compositor and no client. Its control paints the shell another
# color, which the screenshot must show instead, so the claim's color is the
# page read back.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-screenshot.sh
