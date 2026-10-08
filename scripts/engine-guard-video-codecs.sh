#!/usr/bin/env bash
# The engine plays H.264 and AAC.
# See packages/domicile-engine/scripts/guard-video-codecs.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-video-codecs.sh
