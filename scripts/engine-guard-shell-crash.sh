#!/usr/bin/env bash
# Checks that a crashed shell ends the engine with a FATAL line saying it is a
# bug in Domicile, instead of showing the sad tab (patch 0124).
#
# Headless; the crash goes in over the debugging port.
#
# Control: a shell left alone, which must keep the engine running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-crash.sh
