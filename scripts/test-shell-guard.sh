#!/usr/bin/env bash
# Which end the shell guard blames when nothing gets embedded.
#
# The unit is the embed stage in `spike-shell.sh` — the block that runs after a
# client is started and before anything looks at pixels. It decides between two
# sentences that read alike and mean opposite things: the page was told about a
# client and did nothing with it, or nothing ever told the page anything.
#
# It exists because the first version of that stage asserted the first without
# establishing it. A kitty that failed to launch produced "was announced a
# client and never embedded it", which sends whoever reads the annotation to
# the page — and the page would be fine. This branch has already shipped a box
# assertion that compared digits out of a colour string and a stability check
# that measured an idle client; a sentence that names the wrong end is the same
# class of defect, and it costs a CI cycle each time.
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships, and it reports through the real `annotate` rather than a stub.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/spike-shell.sh"
# The real one, as test-annotate.sh does: what a guard says is the behaviour,
# and a stub that spells `::error::` itself would not be it.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From `EMBEDDED=0` to the line it prints when it is satisfied. Both ends are
# whole lines, so this cannot half-match.
BLOCK="$(awk '/^EMBEDDED=0$/,/^echo "the shell embedded the client it was announced"$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no embed stage in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

# What the two logs actually contain, so a grep tightened past the real thing
# fails here rather than in CI twenty minutes later. Provenance is not the same
# for all three and saying so is the point:
#
# - JOINED and EMBEDDING are verbatim from job 101725135992 — JOINED from that
#   run's own compositor log with the ANSI colouring stripped, EMBEDDING from
#   the client-window guard's engine log in the same job, because the run this
#   stage was written for embedded nothing and therefore has no such line to
#   take. Chromium's stderr stamps are the runner's local clock and the
#   compositor's are UTC, which is why the two do not line up.
# - APPEARED is BUILT from the format string at domicile-compositor's
#   main.rs:4065, not copied: the failing run's diagnostics counted the line
#   without printing one. It is the one fixture nothing verbatim backs, and if
#   that log site is reworded this test keeps passing while the guard stops
#   seeing it.
APPEARED='2026-09-07T11:37:14.581795Z  INFO domicile_compositor: toplevel mapped -> Host::app_appeared app_id=app-1'
JOINED='2026-09-07T11:37:13.641032Z  INFO domicile_compositor: chrome agreed the protocol; it now gets the desktop'
EMBEDDING='[875919:875919:0907/043334.191180:INFO:third_party/blink/renderer/platform/graphics/external_surface_embedder.cc:100] domicile: embedding "app-1" at LocalSurfaceId(1, 1, 8D4C...) under FrameSinkId(6, 3), 992x639'
NOISE='[875919:875919:0907/043334.201180:ERROR:dbus/bus.cc:405] Failed to connect to the bus: Could not parse server address'

# The block polls until it embeds or until the compositor is gone, so a case
# that must fail is given one that already is — a child reaped before the block
# starts, which `kill -0` reports as gone and nothing else can be handed to by
# accident. A case that must pass gets one that outlives the check.
#
# `after` is what proves the loop is a loop: the line lands a couple of seconds
# in, so a block that read its logs once would report the failure instead.
verdict() { # $1 compositor log, $2 engine log, $3 (optional) engine log after 2s
  local dir; dir="$(mktemp -d "$FIXTURES/XXXXXX")"
  printf '%s\n' "$1" >"$dir/comp"
  printf '%s\n' "$2" >"$dir/engine"
  : >"$dir/bridge"; : >"$dir/client"
  local live=no
  { printf '%s\n' "$2"; printf '%s\n' "${3:-}"; } | grep -q 'domicile: embedding' &&
    live=yes
  (
    SHELL_NAME=simple
    CLIENT_DISPLAY=wayland-2
    COMP_LOG="$dir/comp" ENGINE_LOG="$dir/engine"
    BRIDGE_LOG="$dir/bridge" CLI_LOG="$dir/client"
    if [ -n "${3:-}" ]; then
      ( sleep 2; printf '%s\n' "$3" >>"$dir/engine" ) &
    fi
    if [ "$live" = yes ]; then
      sleep 60 & COMP=$!
      eval "$BLOCK" 2>/dev/null | tail -1
      kill $COMP 2>/dev/null
    else
      sleep 0 & COMP=$!
      wait "$COMP"
      eval "$BLOCK" 2>/dev/null | head -1
    fi
  )
}

expect "a client announced and embedded is the shell working" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$APPEARED" "$NOISE
$EMBEDDING")"

expect "announced and not embedded blames the page" \
  "::error::spike-shell: simple was announced a client and never embedded it, so the page is not hearing the host" \
  "$(verdict "$JOINED
$APPEARED" "$NOISE")"

expect "never announced blames the client, not the page" \
  "::error::spike-shell: no client ever mapped on wayland-2, so the shell was told about nothing and there was nothing to embed" \
  "$(verdict "$JOINED" "$NOISE")"

# The announcement is evidence for the blame, not a condition of success: the
# page embedding is the thing being measured, and a compositor log that missed
# the line for any reason must not turn a working shell red.
expect "an embed with no announcement in the log still passes" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED" "$EMBEDDING")"

# Everything above hands the block finished logs, which a block that never
# looped would also satisfy. This one arrives while it is waiting.
expect "an embed that arrives while it is still waiting is seen" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$APPEARED" "$NOISE" "$EMBEDDING")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
