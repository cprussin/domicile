#!/usr/bin/env bash
# The hop from the compositor's socket into a page, priced by the page.
#
# Cheap, and deliberately: no Wayland, no client, no GPU and no window — a
# socket with a stand-in on the far end and a document that listens. What it
# measures is the stage ENGINE-FORK.md phase 2 asked for a stamp for, and it
# reads the stamp's SHAPE as well as its value, because an attribute that is
# never filled in reports a plausible hop and the instrument this replaces was
# deleted for exactly that.
#
# NO CONTROL RUN, because its control is inside the run. The stand-in sends a
# cursor the engine knows, one it does not, and another it does, in that order:
# the middle one must not reach the page and the third one must, which is what
# tells a refusal apart from a channel that died. A separate run could not
# establish the pair.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard guard-control-arrival.sh
