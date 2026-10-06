#!/usr/bin/env bash
# Checks which side receives a Meta chord pressed into a nested desktop.
#
# `engine-guard-shortcuts-inhibitor.sh` checks that the engine requests the
# inhibitor; this checks that the host honors it. A sway binding on `Mod4+y`
# and the page's keydown listener both watch one chord sent through a virtual
# keyboard. Each observer is first shown to work, so a lost key fails.
#
# The control runs without `--domicile-inhibit-host-shortcuts`: the host must
# take the chord and the page must not.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shortcuts-inhibitor-chord.sh
