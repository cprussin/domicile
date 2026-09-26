#!/usr/bin/env bash
# The engine asking a host compositor to stop matching its own shortcuts.
#
# Patch `0038` is what lets a shell's Meta chords reach a desktop nested in
# somebody else's Wayland session, and nothing observed any part of it until
# this ran. What it reads is `inhibit_shortcuts` on the wire under
# `WAYLAND_DEBUG=1` — the request was MADE. Not that a key was pressed, and not
# that the host honored it; `ROADMAP.md` carries that as what is left.
#
# Under a nested compositor, because a request needs somebody to make it to:
# `--ozone-platform=headless` has no host to ask. Its control is the same run
# with `--domicile-inhibit-host-shortcuts` left off, where the request must be
# absent — which is what establishes that the grep is reading the switch's
# doing rather than something every nested chrome does.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shortcuts-inhibitor.sh
