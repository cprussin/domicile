#!/usr/bin/env bash
# Tests which side `guard-shell.sh` blames when nothing is embedded.
#
# The embed stage must tell apart a page that got the client announcement and
# did not embed it from a page that never got one. Blaming the wrong side sends
# the reader to the wrong code and costs a CI cycle.
#
# The block is read from the real script and reports through the real
# `annotate`, so a moved or rewritten block fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell.sh"
# The real helpers, as test-annotate.sh does, since the guard's message is
# what is tested.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From `EMBEDDED=0` to the success line. Both are whole-line anchors.
BLOCK="$(awk '/^EMBEDDED=0$/,/^echo "the shell embedded the client it was announced"$/' "$GUARD")"
# What the stage polls between reads, and the restart pattern it reads:
# whether `domicile`'s desktop is still the one the guard started.
UP="$(awk '/^RESTARTED=/,/^\}$/' "$GUARD")"
[ -n "$BLOCK" ] && [ -n "$UP" ] || {
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

# Log lines as the compositor and engine write them, so an overly strict grep
# fails here instead of in CI.
#
# - JOINED and EMBEDDING are copied from real CI logs (ANSI stripped).
#   Chromium stamps local time and the compositor stamps UTC.
# - APPEARED is built from the format string in domicile-compositor's
#   windows.rs. If that log site is reworded, this test still passes while the
#   guard stops matching.
APPEARED='2026-09-07T11:37:14.581795Z  INFO domicile_compositor: toplevel drew -> app_appeared app_id=app-1'
JOINED='2026-09-07T11:37:13.641032Z  INFO domicile_compositor: chrome agreed the protocol; it now gets the desktop'
# Built from the format string in domicile-compositor's `freshened`, with the
# same caveat as APPEARED. The count is matched: zero displays is not a
# described desktop.
DESCRIBED='2026-09-07T11:37:13.642011Z  INFO domicile_compositor: told the chrome about 1 display(s)'
NO_DISPLAYS='2026-09-07T11:37:13.642011Z  INFO domicile_compositor: told the chrome about 0 display(s)'
EMBEDDING='[875919:875919:0907/043334.191180:INFO:third_party/blink/renderer/platform/graphics/external_surface_embedder.cc:100] domicile: embedding "app-1" at LocalSurfaceId(1, 1, 8D4C...) under FrameSinkId(6, 3), 992x639'
NOISE='[875919:875919:0907/043334.201180:ERROR:dbus/bus.cc:405] Failed to connect to the bus: Could not parse server address'
# Built from engine_session.rs and spike_probes.rs. A real compositor log has both
# before any client submits a frame, so a check matching `frame` instead of
# `first frame` would always pass.
BROKERED='2026-09-07T11:37:14.601033Z  INFO domicile_compositor: the browser brokered a frame sink app_id=app-1 surface=1'
COMMITTED='2026-09-07T11:37:14.701044Z  INFO domicile_compositor: the chrome committed a frame'

# The block polls until it embeds or `domicile` exits. A failing case gets an
# already-reaped child, which `kill -0` reports as gone. A passing case gets
# one that outlives the check.
#
# `after` arrives two seconds in, which proves the block polls instead of
# reading once.
verdict() { # $1 compositor log, $2 engine log, $3 (optional) engine log after 2s, $4 (optional) domicile's own lines
  local dir; dir="$(mktemp -d "$FIXTURES/XXXXXX")"
  printf '%s\n' "$1" >"$dir/comp"
  printf '%s\n' "$2" >"$dir/engine"
  printf '%s\n' "${4:-}" >"$dir/run"
  : >"$dir/bridge"; : >"$dir/client"
  local live=no
  { printf '%s\n' "$2"; printf '%s\n' "${3:-}"; } | grep -q 'domicile: embedding' &&
    live=yes
  (
    SHELL_NAME=simple
    CLIENT_DISPLAY=wayland-2
    COMP_LOG="$dir/comp" ENGINE_LOG="$dir/engine" RUN_LOG="$dir/run"
    BRIDGE_LOG="$dir/bridge" CLI_LOG="$dir/client"
    eval "$UP"
    if [ -n "${3:-}" ]; then
      ( sleep 2; printf '%s\n' "$3" >>"$dir/engine" ) &
    fi
    if [ "$live" = yes ]; then
      # SIGKILL: a SIGTERM before the child execs `sleep` is lost to the
      # EXIT trap's handler, and the sleep holds this substitution open.
      sleep 60 & DOMICILE_PID=$!
      eval "$BLOCK" 2>/dev/null | tail -1
      kill -KILL $DOMICILE_PID 2>/dev/null
    else
      sleep 0 & DOMICILE_PID=$!
      wait "$DOMICILE_PID"
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

# A shell that renders nothing until it has a screen embeds nothing for a
# reason unrelated to the announcement.
expect "announced but never given a desktop blames the desktop" \
  "::error::guard-shell: simple was announced a client and its handshake carried no display, so a chrome that lays out on a screen had nowhere to put a window. The desktop, not the announcement" \
  "$(verdict "$JOINED
$APPEARED" "$NOISE")"

# Zero displays is not a desktop. Without the digit in the pattern this blames
# the page.
expect "a desktop of no displays is not a desktop" \
  "::error::guard-shell: simple was announced a client and its handshake carried no display, so a chrome that lays out on a screen had nowhere to put a window. The desktop, not the announcement" \
  "$(verdict "$JOINED
$NO_DISPLAYS
$APPEARED" "$NOISE")"

# With neither a client nor a desktop, blame the client: no client mapped, so
# there was nothing to embed.
expect "no client and no desktop still blames the client" \
  "::error::guard-shell: no client ever mapped on wayland-2, so the shell was told about nothing and there was nothing to embed" \
  "$(verdict "$JOINED" "$NOISE")"

# The announcement only decides the blame. A successful embed passes even if
# the compositor log lacks the line.
expect "an embed with no announcement in the log still passes" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED" "$EMBEDDING")"

# Likewise, the desktop line only decides the blame.
expect "an embed with no desktop in the log still passes" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$APPEARED" "$EMBEDDING")"

# The cases above give finished logs. This one's line arrives while the block
# is waiting.
expect "an embed that arrives while it is still waiting is seen" \
  "the shell embedded the client it was announced" \
  "$(verdict "$JOINED
$DESCRIBED
$APPEARED" "$NOISE" "$EMBEDDING")"

# `domicile` restarts a component that dies, under the same pid. A restarted
# engine has lost the shell, so the run is over even though `domicile` lives.
RESTARTED='domicile: starting the engine again in 1s — that is failure 1 of 5 in a row.'
expect "a component domicile restarted ends the run" \
  "::error::guard-shell: domicile restarted a component, so this is no longer the desktop the guard started%0A%0A$RESTARTED" \
  "$(verdict "$JOINED
$DESCRIBED
$APPEARED" "$NOISE" "" "$RESTARTED")"

# The block re-reads both flags after the loop, since a line can land between
# the last poll and the verdict. That window is too small to schedule a
# fixture into, so this checks the code's structure: complete fixture logs
# would pass even without the re-read.
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

# The first-frame stage. `engine found` matches one pixel of the color anywhere
# in the browser window, so the guard separately checks that the client's
# buffer reached the engine.
# Anchored on a comment, not the `grep`, so weakening the pattern fails the
# case below instead of reporting moved markers.
FRAME="$(awk '/^# `engine found` already implies a first frame, since the probe runs in$/,/^fi$/' "$GUARD")"
[ -n "$FRAME" ] || {
  echo "no first-frame check in $GUARD — its markers moved. Fix this test." >&2
  exit 1
}

# Built from spike_probes.rs's log site, with the same caveat as APPEARED.
FIRST_FRAME='2026-09-07T11:37:15.101020Z  INFO domicile_compositor: the engine took this app'"'"'s first frame app_id=app-1'

# Not `eval ... | head -1`: a pipeline runs the block in a subshell, so its
# `exit 1` would not stop "past the frame check" from printing. Write to a
# file and report the status instead.
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

# Both chrome `frame` lines are present but the client's is not. A check
# matching less than `first frame` would read this as a client that drew.
expect "the chrome's own frames are not the client's" \
  "stopped: ::error::guard-shell: the engine never took a frame from simple's client, so whatever is on the page is not the client's window" \
  "$(frame_verdict "$JOINED
$BROKERED
$COMMITTED
$APPEARED")"

# The startup stage: the apps' display, or which part of the desktop never
# came up. `domicile` has exited in every case, so the wait ends at once.
STARTUP="$(awk '/^for _ in \$\(seq 1 360\); do$/,/^fi$/' "$GUARD")"
[ -n "$STARTUP" ] || {
  echo "no startup stage in $GUARD — its markers moved. Fix this test." >&2
  exit 1
}

startup_verdict() { # $1 compositor log, $2 run log
  local dir; dir="$(mktemp -d "$FIXTURES/XXXXXX")"
  printf '%s\n' "$1" | sed '/^$/d' >"$dir/comp"
  printf '%s\n' "$2" >"$dir/run"
  (
    COMP_LOG="$dir/comp" RUN_LOG="$dir/run"
    eval "$UP"
    sleep 0 & DOMICILE_PID=$!
    wait "$DOMICILE_PID"
    eval "$STARTUP" >"$dir/out" 2>/dev/null
    echo "display $CLIENT_DISPLAY" >>"$dir/out"
  )
  head -1 "$dir/out" | sed 's/%0A.*//'
}

# Built from domicile-compositor's main.rs; the chrome's display is on the
# next line and must not be taken for the apps'.
APPS='2026-09-07T11:37:12.101020Z  INFO domicile_compositor: domicile-compositor: apps connect here (WAYLAND_DISPLAY) display="wayland-2"'
CHROMES='2026-09-07T11:37:12.101030Z  INFO domicile_compositor: domicile-compositor: the chrome connects here (WAYLAND_DISPLAY) display="wayland-2-chrome"'
# Built from domicile.rs's `broker` milestone and milestones.rs.
NO_BROKER="domicile: the engine's broker socket at /run/domicile-1/broker has not turned up after 30s."

expect "the apps' display is the one clients use" \
  "display wayland-2" \
  "$(startup_verdict "$APPS
$CHROMES" "")"

expect "an engine with no broker socket is blamed on the engine" \
  "::error::guard-shell: the engine never opened its broker socket" \
  "$(startup_verdict "" "$NO_BROKER")"

expect "a compositor that spoke and named no display says so" \
  "::error::guard-shell: the compositor never named its Wayland display" \
  "$(startup_verdict "$JOINED" "")"

expect "a compositor that said nothing did not start" \
  "::error::guard-shell: the compositor did not start" \
  "$(startup_verdict "" "domicile: the compositor exited (exit status: 1)")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
