#!/usr/bin/env bash
# The shell showing a picture from this machine with nothing asking whether it
# may — patch 0066, which classes domicile:// loopback for Local Network
# Access.
#
# Headless, no compositor and no client. Its control is two runs on an
# ordinary page the engine is told is public: a picture from its own address
# space, which MUST show, then one from loopback, which must NOT — so LNA is
# shown live in the engine whose shell it exempts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-shell-local-network.sh
