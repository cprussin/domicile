#!/usr/bin/env bash
# Guard: a page in a browser window asking for the camera asks the shell, gets
# the camera when the shell allows, and the site's setting reads allowed.
#
# Under a nested Wayland compositor, with Chromium's fake camera: Chrome denies
# every permission request on a headless screen. Control: the shell denies.
# The page must be refused and the site's camera read blocked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-webview-permissions.sh
