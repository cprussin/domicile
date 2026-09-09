#!/usr/bin/env bash
# Which end the shell guard blames when nothing gets embedded.
#
# The unit is the embed stage in `guard-shell.sh` — the block that runs after a
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
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell.sh"
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
# BUILT from the format string in domicile-compositor's `freshened`, like
# APPEARED and with the same caveat: reword that log site and this test keeps
# passing while the guard stops seeing the line. The count is part of what is
# matched — a chrome told about zero displays has been told nothing useful, and
# a grep that accepted `0` would call an empty desktop a described one.
DESCRIBED='2026-09-07T11:37:13.642011Z  INFO domicile_compositor: told the chrome about 1 display(s)'
NO_DISPLAYS='2026-09-07T11:37:13.642011Z  INFO domicile_compositor: told the chrome about 0 display(s)'
EMBEDDING='[875919:875919:0907/043334.191180:INFO:third_party/blink/renderer/platform/graphics/external_surface_embedder.cc:100] domicile: embedding "app-1" at LocalSurfaceId(1, 1, 8D4C...) under FrameSinkId(6, 3), 992x639'
NOISE='[875919:875919:0907/043334.201180:ERROR:dbus/bus.cc:405] Failed to connect to the bus: Could not parse server address'
# BUILT from engine_session.rs:198 and main.rs:1439. Neither is the line the
# frame check looks for, and that is the point of having them: a real
# compositor log carries both long before a client submits anything, so a check
# grepping for `frame` rather than `first frame` would be satisfied by every
# run there has ever been and no case here would notice.
BROKERED='2026-09-07T11:37:14.601033Z  INFO domicile_compositor: the browser brokered a frame sink app_id=app-1 surface=1'
COMMITTED='2026-09-07T11:37:14.701044Z  INFO domicile_compositor: the chrome committed a frame'

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
$DESCRIBED
$APPEARED" "$NOISE
$EMBEDDING")"

expect "announced, told about a desktop and not embedded blames the page" \
  "::error::guard-shell: simple was announced a client and never embedded it, so the page is not hearing the host" \
  "$(verdict "$JOINED
$DESCRIBED
$APPEARED" "$NOISE")"

expect "never announced blames the client, not the page" \
  "::error::guard-shell: no client ever mapped on wayland-2, so the shell was told about nothing and there was nothing to embed" \
  "$(verdict "$JOINED" "$NOISE")"

# The third end, which arrived with manganese. A shell that renders nothing
# until it has a screen embeds nothing for a reason that has nothing to do with
# whether it heard the announcement, and the sentence above would send the
# reader to the announcement path.
expect "announced but never given a desktop blames the desktop" \
  "::error::guard-shell: simple was announced a client and its handshake carried no display, so a chrome that lays out on a screen had nowhere to put a window. The desktop, not the announcement" \
  "$(verdict "$JOINED
$APPEARED" "$NOISE")"

# A described desktop with nothing in it is not a desktop. Without the digit in
# the pattern this reports the page instead, which is the wrong end again.
expect "a desktop of no displays is not a desktop" \
  "::error::guard-shell: simple was announced a client and its handshake carried no display, so a chrome that lays out on a screen had nowhere to put a window. The desktop, not the announcement" \
  "$(verdict "$JOINED
$NO_DISPLAYS
$APPEARED" "$NOISE")"

# Order matters and only one case can prove it: a run where neither the client
# mapped nor a desktop was described still blames the client, because a shell
# told about nothing has nothing to put anywhere either way.
expect "no client and no desktop still blames the client" \
  "::error::guard-shell: no client ever mapped on wayland-2, so the shell was told about nothing and there was nothing to embed" \
  "$(verdict "$JOINED" "$NOISE")"

# The announcement is evidence for the blame, not a condition of success: the
# page embedding is the thing being measured, and a compositor log that missed
# the line for any reason must not turn a working shell red.
expect "an embed with no announcement in the log still passes" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED" "$EMBEDDING")"

# Same for the desktop: it is evidence for the blame, never a condition of
# success. A page that embedded a client plainly had somewhere to put it.
expect "an embed with no desktop in the log still passes" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$APPEARED" "$EMBEDDING")"

# Everything above hands the block finished logs, which a block that never
# looped would also satisfy. This one arrives while it is waiting.
expect "an embed that arrives while it is still waiting is seen" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$DESCRIBED
$APPEARED" "$NOISE" "$EMBEDDING")"

# The two flags are re-read once more after the loop, because a line landing
# between the loop's last read and the verdict would otherwise be missed and
# the guard would blame the wrong end about a run that was fine. That window is
# microseconds wide and no fixture can be scheduled into it, so this is pinned
# by structure rather than by behaviour — and says so rather than implying a
# stronger test than it is. What it catches is a re-read being deleted, which
# is the thing that actually happens: with complete fixture logs the loop's own
# grep covers for it and every case above stays green.
AFTER="$(printf '%s\n' "$BLOCK" | awk '/^done$/,0')"
[ -n "$AFTER" ] || {
  echo "no post-loop section in the embed stage — it was restructured." >&2
  exit 1
}
while IFS='|' read -r what pattern; do
  expect "$what is read again after the loop" "yes" \
    "$(printf '%s\n' "$AFTER" | grep -qE "grep .*&& $pattern=1" && echo yes || echo no)"
done <<'FLAGS'
the announcement|ANNOUNCED
the desktop|DESKTOP
FLAGS

# The other stage this file now covers: the one that decides whether the pixel
# search was looking at a client's window at all. `engine found` is satisfied by
# a single pixel of the colour anywhere in the browser's window, so the pass has
# to establish separately that the client's buffer reached the engine. Run out
# of the real script for the same reason as the block above.
# Anchored on the comment rather than on the `grep` itself, deliberately: a
# marker that contains the pattern turns "the pattern was weakened" into "the
# markers moved", and the case below never gets to say the sharper thing.
FRAME="$(awk '/^# WHICH FAILURE IT WAS, not whether there was one\. The probe runs inside$/,/^fi$/' "$GUARD")"
[ -n "$FRAME" ] || {
  echo "no first-frame check in $GUARD — its markers moved. Fix this test." >&2
  exit 1
}

# BUILT from main.rs's log site, same caveat as APPEARED and DESCRIBED.
FIRST_FRAME='2026-09-07T11:37:15.101020Z  INFO domicile_compositor: the engine took this app'"'"'s first frame app_id=app-1'

# Deliberately NOT `eval ... | head -1`: a pipeline puts the block in a
# subshell, `exit 1` leaves only that, and "past the frame check" prints anyway
# — so a test written that way pins the sentence and lets the stop be deleted.
# The output goes to a file and the status is reported beside it.
frame_verdict() { # $1 compositor log
  local dir; dir="$(mktemp -d "$FIXTURES/XXXXXX")"
  printf '%s\n' "$1" >"$dir/comp"
  (
    SHELL_NAME=simple
    COMP_LOG="$dir/comp"
    eval "$FRAME" >"$dir/out" 2>/dev/null
    echo "past the frame check" >>"$dir/out"
  )
  local stopped=$?
  local said; said="$(head -1 "$dir/out" 2>/dev/null)"
  if [ "$stopped" -eq 0 ]; then
    echo "carried on"
  else
    echo "stopped: $said"
  fi
}

expect "a frame the engine took lets the search stand" \
  "carried on" \
  "$(frame_verdict "$JOINED
$BROKERED
$COMMITTED
$APPEARED
$FIRST_FRAME")"

# The case the check exists for, and the one that says what it is for: the two
# `frame` lines are present and the client's own is not, so a check grepping
# for anything shorter than `first frame` reads this run as a client that drew.
expect "the chrome's own frames are not the client's" \
  "stopped: ::error::guard-shell: the engine never took a frame from simple's client, so whatever is on the page is not the client's window" \
  "$(frame_verdict "$JOINED
$BROKERED
$COMMITTED
$APPEARED")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
