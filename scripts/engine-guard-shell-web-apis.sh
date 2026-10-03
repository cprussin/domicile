#!/usr/bin/env bash
# The shell's own page may show a notification and may read an answer another
# origin shares -- what a widget on its bar needs.
#
# Headless, no compositor and no client. Its control is two runs of the same
# shell: a box painted unasked, which MUST show, then one waiting on an origin
# that shares nothing, which must NOT -- so the claim's color is CORS answering
# the shell, and not a fetch that reads whatever it is pointed at.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-web-apis.sh
