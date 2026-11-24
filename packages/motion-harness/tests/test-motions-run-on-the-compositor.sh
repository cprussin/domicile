#!/usr/bin/env bash
# Plays every motion in the built Storybook, in headless Chromium, and fails on
# any animation of it that runs on the main thread. DOMICILE_MOTION_CHROMIUM
# names a Chromium in place of Playwright's own. See the package README.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun src/harness.ts ${DOMICILE_MOTION_CHROMIUM:+--chromium "$DOMICILE_MOTION_CHROMIUM"}
