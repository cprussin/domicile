#!/usr/bin/env bash
# Measures how long a keystroke takes to reach a pixel.
#
# Sixty rounds of a keystroke and a wait for the draw, so it runs late in the
# group. The control is a client that ignores the keyboard, so the guard cannot
# pass on a client that only draws; it needs three rounds.
#
# The only check here that holds the render node. It reports a duration, and
# another client on the card would look like a regression. Other guards check
# whether a color landed, which load only slows. Held across the control too,
# and taken here rather than around the whole group so the other guards can
# share the card.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# Drops the lock from a trap, so a run that dies still releases it. `drop` is
# a no-op unless this run holds the lock.
CARD="$ROOT/.github/scripts/engine-render-node-lock.sh"

# Who holds the card, readable in a held-lock message. `engine.yml` sets it;
# a manual run names the host and pid.
CARD_OWNER="${CARD_OWNER:-engine-guard-latency.sh on $(hostname) pid $$}"

# `quiet`, not `take`: a compile on the other runner raised the floor from
# 19-29 ms to 39-49 ms even with the card held. This waits until nothing
# compiles and no other run's guards run. A machine that never goes quiet
# exits 77 (skipped) rather than reporting a bad number.
"$CARD" quiet "$CARD_OWNER"
trap '"$CARD" drop "$CARD_OWNER"' EXIT

engine_guard_and_control_under_wayland guard-latency.sh
