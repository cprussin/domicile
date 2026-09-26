#!/usr/bin/env bash
# A Meta chord pressed into a nested desktop, and which side took it.
#
# `engine-guard-shortcuts-inhibitor.sh` reads that the engine ASKED the host
# compositor for a shortcuts inhibitor. This reads whether the host honored it:
# a sway binding on `Mod4+y` and the page's own keydown listener, one chord
# through a virtual keyboard, and which of the two saw it. Each observer is
# shown able to see before its absence is believed — the binding fires once at
# an empty host, a plain key reaches the page — so a key that went nowhere is a
# failure and not a pass.
#
# Its control is the same run with `--domicile-inhibit-host-shortcuts` left off,
# where the host must take the chord and the page must not.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shortcuts-inhibitor-chord.sh
