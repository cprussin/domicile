#!/usr/bin/env bash
# Measures the hop from the compositor's socket into a page.
#
# Needs no Wayland, client or GPU: a stand-in on the socket and a page that
# listens. It checks the arrival stamp's shape as well as its value, since an
# unfilled stamp reports a plausible number. See
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#keystroke-to-pixel.
#
# No separate control run: the stand-in sends a known cursor, an unknown one,
# then a known one. The unknown one must not arrive and the last must, which
# tells a refusal from a dead channel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-control-arrival.sh
