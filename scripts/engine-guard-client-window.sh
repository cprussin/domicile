#!/usr/bin/env bash
# A real client's own pixels reaching the page, which is the whole claim.
#
# A Wayland client draws a color, the compositor submits its buffer to the
# engine, and the page's canvas is read back. Every other guard here asserts
# something around that; this is the one that asserts it.
#
# Its control is the same run with no client: nothing drew, and the guard must
# say so. A guard that cannot fail is not a guard, and this repository has
# shipped three that could not.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-client-window.sh
