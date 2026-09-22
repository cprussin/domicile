#!/usr/bin/env bash
# Phase 1's deliverable: a real Wayland client's window on the page, and the
# color it drew coming back out of the display compositor.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-client-window.sh /build/chromium/src
#
# From Domicile's full shell, not Chromium's: `engineRuntimeLibs` in flake.nix
# puts Chromium's runtime libraries beside the GL stack, and this needs both —
# the GL stack or no client can hand the compositor a dmabuf at all, Chromium's
# or libdomicile_engine.so will not load.
#
# Every pixel check before this one was the weak form — "the buffer's own zeroed
# content rather than the fallback" — because no harness had a GL context to
# draw known content with. A real client does. kitty is a real GL client and its
# background color is settable, so the assertion here is the strong one: the
# color the client drew.
#
# FOUR PROCESSES, AND THE ORDER MATTERS.
#
#   sway        the nested compositor the engine runs under, because
#               --ozone-platform=headless cannot import a dmabuf. Provided by
#               under-wayland.sh, which this runs inside
#   chrome      the forked engine, on a page whose <canvas> embeds, listening
#               on --domicile-broker-socket
#   compositor  domicile-compositor with --engine-socket pointing at that
#               socket. It is the producer now, so it holds the browser's
#               invitation and nothing else can
#   kitty       a GL client of the compositor, drawing one known color
#
# The compositor is the only process that can ask what viz drew — one producer
# per socket — so it logs the pixel and this greps for it. That log line is
# throwaway with the rest of the spike.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-client-window: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# What the client draws and what the page must therefore show. Not the page's
# background and not a color any other spike producer submits.
COLOR="${COLOR:-3366CC}"
# The app id the client announces, which the page must ask for by name: the
# broker dispatches embeds on it so that two windows are two surfaces.
CLIENT_APP_ID="${CLIENT_APP_ID:-app-1}"
# NEGATIVE=1 runs the same thing with no client at all. Nothing draws, so the
# page keeps its fallback and the assertion must fail — a green run with no
# control is not evidence.
NEGATIVE="${NEGATIVE:-0}"

# How long the client is given. Longer than everything that can happen before
# and during the poll, because the probe runs on the submit path: a client
# reaped mid-poll stops the measurement, and the guard would then report that
# nothing ever drew.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-420}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-client-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-client-window-profile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"

ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
# Collected rather than three variables, because two of the three may never be
# set — a run that fails early, and the negative control, which starts no
# client — and `kill ""` is an error rather than a no-op.
STARTED=()
# Kept rather than discarded: when the page shows its own background instead of
# the client's color, the compositor's log is the only place that says which
# app id it brokered — and that is now the thing an embed is dispatched on.
# A run and its own negative control are two different measurements, so they
# get two different files. Sharing one meant the control's logs overwrote the
# run's and the diagnostics printed whichever went last — which, when the two
# disagree, is exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
LOG_COPY="${LOG_COPY:-/tmp/domicile-client-window$WHICH-compositor.log}"
# The browser's own log, which used to be thrown away with the tempfile. It is
# where the page's console lines are — which app was embedded, at which
# SurfaceId, and which was refused — and a run where the page showed the wrong
# window cannot be told apart from one where a client never drew without them.
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-client-window$WHICH-engine.log}"
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
}
trap cleanup EXIT

# Into the checkout before anything is looked for: OUT is relative to it, the
# way build.sh and spike.sh treat it.
cd "$CHROMIUM" || {
  annotate "guard-client-window: $CHROMIUM is not a directory this can enter"
  exit 1
}

[ -x "$OUT/chrome" ] || {
  annotate "guard-client-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./scripts/build.sh"
  exit 1
}
[ -f "$OUT/libdomicile_engine.so" ] || {
  annotate "guard-client-window: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-client-window: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
# kitty lives in the Domicile full dev shell, not in Chromium's toolchain shell
# — and this runs inside the latter. Fetched the way under-wayland.sh fetches
# sway, so the check does not depend on which shell it was started from.
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-client-window: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# The engine, on the page that embeds. GPU because a dmabuf import needs one,
# and wayland because headless ozone has no CreateNativePixmapFromHandle.
"$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-page.html?app=$CLIENT_APP_ID" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 120); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-client-window: the page never asked to embed" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER"

# The compositor, as the producer. libdomicile_engine.so is dlopened by name.
export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-client-window.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" \
    --expect-a-page no >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

# WAIT FOR THE COMPOSITOR, AND ONLY FOR THE COMPOSITOR. This used to wait for
# `brokered a frame sink`, which `surface_for` in engine_session.rs logs when a
# WAYLAND CLIENT COMMITS A FRAME -- and the client is started below, after this.
# So the grep could not match however long it ran: every run of this guard,
# green ones included, spent the whole 120 half-second looks here. It is in the
# measurements, once anyone read them for this rather than for the poll --
# lib-control-budget.sh has the whole step at ~1m05 of which the draw poll was
# ~5s. And the minute was not the worst of it: a client that starts a minute
# late is what put spike-page.html's embed deadline out of reach by
# construction, so a passing run also printed a console line that reads as the
# reason it failed.
#
# guard-two-windows.sh has the right shape: start_client, then await_broker. A
# frame sink is a fact about a client, so it can only be waited for once there
# is one.
#
# `chrome protocol socket up` is a fact about the COMPOSITOR: main.rs logs it
# from `bind_chrome_socket`, on the main thread, where a failed bind ends the
# run -- and the wayland socket a client dials was opened above it. So it is
# reachable with nothing else running, which is the whole of what was wrong.
#
# 120 looks at half a second, which is what the unsatisfiable wait cost and is
# kept: patience is free now that it can end early, and a slow machine still
# gets its minute. scripts/test-the-client-window-guard-waits-for-the-compositor.sh
# is what holds this together.
COMPOSITOR_LOOKS="${COMPOSITOR_LOOKS:-120}"

UP=0
for _ in $(seq 1 "$COMPOSITOR_LOOKS"); do
  grep -q "chrome protocol socket up" "$COMP_LOG" 2>/dev/null && { UP=1; break; }
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "guard-client-window: the compositor did not start" "$COMP_LOG"
  echo "the compositor did not start. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
# A running compositor that never got that far is a third thing, and it has to
# be said rather than fallen through: starting a client against a compositor
# whose sockets are not up measures the harness, and the guard would report
# that the seam is broken.
if [ "$UP" != "1" ]; then
  annotate_from "guard-client-window: the compositor is running and never bound its chrome socket" "$COMP_LOG"
  echo "the compositor is running and never bound its chrome socket. It said:" >&2
  tail -20 "$COMP_LOG" >&2
  exit 1
fi
echo "the compositor is up, and nothing has asked it for a window yet"

# Which wayland socket it opened for apps.
CLIENT_DISPLAY=$(grep -oE "wayland-[0-9]+" "$COMP_LOG" | head -1)
CLIENT_DISPLAY="${CLIENT_DISPLAY:-wayland-1}"

if [ "$NEGATIVE" = "1" ]; then
  echo "negative control: no client, so nothing draws"
else
  echo "driving kitty, drawing #$COLOR"
  # Prints, rather than sitting idle. The probe runs on the submit
  # path — it is called when a client commits a frame the engine
  # takes — so a client that stops drawing stops the measurement
  # dead, and a guard waiting for a box to hold still would then be
  # measuring the client's idleness. kitty redraws for its cursor
  # blink and gives up on that after about fifteen seconds; a
  # character every fifth of a second keeps it committing for as
  # long as the guard is watching.
  #
  # The dots are foreground pixels and the box is the background
  # color's extent, so they cost nothing the measurement cares
  # about.
  NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$COLOR" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do printf .; sleep 0.2; done' >"$CLI_LOG" 2>&1 &
  STARTED+=($!)
fi

# The compositor logs what viz drew each time it submits.
#
# HOW LONG TO WATCH IS NOT THE SAME QUESTION FOR THE TWO RUNS. The guard stops
# the moment a color appears and almost never spends its budget; measured on
# engine run 35496858205, the poll took ~5s of a 1m05 step. The control cannot
# stop early -- with no client there is nothing to appear -- so it spends the
# whole thing every time, which is why it was measured at 2m04.
#
# So the control waits a multiple of what the guard just measured instead. The
# two are consecutive steps of one job against one build, so that number is a
# better statement of "long enough for it to have shown up" than a constant
# chosen for the worst machine. With no measurement to hand -- a control run on
# its own -- it is the full budget. See lib-control-budget.sh.
#
# THE BUDGET WAS 60 AND THAT IS WHAT WENT RED ON `main`. `crux` runs two jobs
# at once and both draw on the one render node; the card is locked only around
# the steps that time something, because a pixel guard beside another client
# "asks whether a color landed, and a second client on the card makes that
# slower rather than wrong" (engine.yml). That holds exactly as long as this
# number outlasts the slowdown. The Chromium tree pool (#485) took an engine
# run from ~4h of compiling to ~11m that is mostly guards, so the two jobs'
# pixel phases now overlap almost every time both fire on one commit -- and
# `Pinned engine` runs 183 and 185 each gave up here at 60s beside a fully
# overlapping engine run. Run 183's was `Engine` run 504 on the same commit,
# which was green: the same guard, against the same series, on the same card,
# passed on the slot that was not the one giving up.
#
# 240 is ~48x the quiet-machine measurement and four times what a busy card ate
# through. It is free on a healthy run for the reason below: the loop breaks the
# moment the client's color lands. What bounds it is `CLIENT_LIVES_FOR` -- the
# probe runs on the submit path, so the poll has to end while there is still a
# client committing frames for it to read.
LOOKS="${LOOKS:-240}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for client-window "$LOOKS")"

# WAIT FOR THE COLOR THIS ASSERTS, NOT FOR ANY COLOR AT ALL. The probe runs on
# the submit path and samples the center of the browser's window as it stands at
# that moment, so the client's surface has not necessarily been aggregated into
# the frame yet: the first thing it reports is routinely the PAGE's own paint.
# Measured on engine run 35678987261 attempt 1 -- `engine drew #FFFFFFFF` 29ms
# after this app's first frame, then `engine drew #FF3F51B5`, the page's indigo
# background, 13ms AFTER `embedded "app-1"`. A loop that broke on the first
# sighting priced one of those as the client's answer and called a working seam
# broken, with `WAITED=1` out of 240 -- so no amount of patience could reach it.
#
# `DRAWN` keeps the last color seen rather than only the matching one, because
# the verdict below reports it: after a poll that ran out, it is the last thing
# the page showed within the budget, which is the finding. "Nothing drew at all"
# stays a different sentence, and it is still the only one the negative control
# can reach -- no client means no `Committer::App` commit, so `publish_frame`
# never runs and the probe never reports. The page's own frames go through
# `publish_chrome_frame`, which has no probe in it.
DRAWN=""
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  DRAWN=$(grep -oE "engine drew #[0-9A-F]{8}" "$COMP_LOG" | tail -1 | grep -oE "[0-9A-F]{8}$")
  [ "${DRAWN#FF}" = "$COLOR" ] && break
  sleep 1
  WAITED=$((WAITED + 1))
done

# Only what the GUARD measured, and only when it saw the thing it was looking
# for: a run that timed out measured its own patience rather than the system's,
# and the control must not inherit that as though it were a reading. On the
# color rather than on `-n`, because a timed-out run now ends holding the page's
# own color and `-n` would write that patience down as a measurement.
if [ "$NEGATIVE" != "1" ] && [ "${DRAWN#FF}" = "$COLOR" ]; then
  budget_note client-window "$WAITED"
fi

echo
if [ -z "$DRAWN" ]; then
  echo "the engine never drew a client frame"
  echo "--- the compositor's last words:"
  grep -aE "engine|frame sink|buffer|dmabuf" "$COMP_LOG" | tail -12 | sed 's/^/  /'
  [ "$NEGATIVE" = "1" ] && { echo "negative control: correct, nothing drew"; exit 0; }
  annotate_from "guard-client-window: the engine never drew a client frame" "$COMP_LOG"
  exit 1
fi

echo "the engine drew #$DRAWN; the client drew #$COLOR"
# kitty's background is opaque, so the alpha is FF and the low 24 bits are the
# color. Compared as a string because the color is exact: a client's own
# buffer is not resampled on the way to the page.
#
# The same comparison the poll breaks on, so reaching here with it false means
# the poll ran out: `#$DRAWN` is then the last thing the page showed within the
# budget rather than its final state, which is what the annotation says.
if [ "${DRAWN#FF}" = "$COLOR" ]; then
  if [ "$NEGATIVE" = "1" ]; then
    annotate "guard-client-window negative control: something drew when nothing should have"
    exit 1
  fi
  echo "PASS: a Wayland client's own window is on the page, in its own color"
  exit 0
fi
annotate "guard-client-window: the page is showing #$DRAWN, which is not the client's #$COLOR"
exit 1
