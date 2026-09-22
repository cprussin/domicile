#!/usr/bin/env bash
# The other shell, and the desktop this project is actually for.
#
# Here rather than assumed, because nothing about `simple` passing says
# `manganese` does: it is built from a different page — a component library
# consumed as source, with its own panda codegen — so `build:vite`'s `^prepare`
# edge is load-bearing for it in a way it is not for `simple`. A shell that
# fails to build is a shell that shows nothing.
#
# AND IT HAS ITS OWN CONTROL, which the first version of this argued was not
# needed because a control is a property of the guard and `simple`'s
# establishes it for both. That is wrong, and it is wrong in the direction that
# matters. `engine found` is satisfied by a single pixel of the color anywhere
# in the browser's window, so what a control actually establishes is a joint
# fact about the guard AND the page under it: that this page does not paint the
# search color by itself. `simple`'s page is a bare desktop and cannot;
# manganese's is a whole component library with tokens derived by `color-mix`,
# and a run where the client's window never lands but one chrome pixel matches
# is green with nothing measured.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control_under_wayland guard-shell.sh manganese
