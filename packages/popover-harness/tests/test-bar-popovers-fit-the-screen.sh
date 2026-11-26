#!/usr/bin/env bash
# Opens every crowded bar popover in the built Storybook, in headless Chromium
# on a small screen, and fails on any that runs off it, doesn't scroll to its
# last row, or has a drawer whose height jumps. DOMICILE_POPOVER_CHROMIUM names
# a Chromium in place of Playwright's own. See the package README.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun src/harness.ts ${DOMICILE_POPOVER_CHROMIUM:+--chromium "$DOMICILE_POPOVER_CHROMIUM"}
