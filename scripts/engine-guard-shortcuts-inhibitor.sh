#!/usr/bin/env bash
# Checks that the engine asks the host compositor to inhibit its shortcuts
# (patch `0038`), so a shell's Meta chords work in a nested desktop.
#
# Reads the `inhibit_shortcuts` request under `WAYLAND_DEBUG=1`. It does not
# check that the host honored it; `engine-guard-shortcuts-inhibitor-chord.sh`
# does.
#
# Needs a nested compositor, since headless has no host to ask. The control
# runs without `--domicile-inhibit-host-shortcuts`, where the request must be
# absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shortcuts-inhibitor.sh
