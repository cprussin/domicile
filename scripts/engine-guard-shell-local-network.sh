#!/usr/bin/env bash
# Checks that the shell loads an image from this machine without a Local
# Network Access prompt (patch 0066 treats domicile:// loopback as local).
#
# Headless, with no compositor or client. The control is a page marked public:
# an image from its own address space must load, and one from loopback must
# not, which shows LNA is active.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-local-network.sh
