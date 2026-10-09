#!/usr/bin/env bash
# Measures keystroke to pixel through the engine with a real client.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-latency.sh /build/chromium/src
#
# On a console login with a panel, run it directly, not under under-wayland.sh:
#
#   PLATFORM=drm nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-latency.sh /build/chromium/src
#
# Covers a key reaching the client, the client drawing, and the pixel reaching
# the page. See `latency.rs` and
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#keystroke-to-pixel.
#
# Asserts that `commit to pixel` is within MOST_FRAMES display frames, so the
# embedding adds no stage of its own. A millisecond threshold would depend on
# runner load. The probe is a `CopyOutputRequest` that forces a draw, so every
# reading is at least one frame and quantized to it.
#
# The denominator is the compositor's advertised display frame, not the
# sampled probe floor: the floor is sampled during startup and varied threefold
# across CI runs. `css_parity.cc` reads viz's frame interval and agrees with the
# advertised one. The floor is still checked against the frame, to catch an
# advertised rate the display is not running at.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-latency.sh
. "$SCRIPTS/lib-latency.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-latency: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
BROKER="${BROKER:-/tmp/domicile-latency-broker}"
PROFILE="${PROFILE:-/tmp/domicile-latency-profile}"
COMPOSITOR="$SCRIPTS/../../../target/debug/domicile-compositor"
APP_ID="${APP_ID:-app-1}"

# NEGATIVE=1 runs a client that ignores keys but still redraws. No round may
# produce a figure.
#
# The control is statistical. The wait bracket (`MIN_WAIT_FRAME_SHARE` to
# `MAX_WAIT_FRAMES` in `latency.rs`) trims implausible commits, but a stray
# redraw can land inside the range real answers occupy (about 1 to 2.7
# frames). A deterministic control would need to match the answer by color,
# as guard-client-window.sh does.
NEGATIVE="${NEGATIVE:-0}"

# Display frames `commit to pixel` may take. A clean run reads about 1.7; an
# extra stage adds a frame.
MOST_FRAMES="${MOST_FRAMES:-2}"

# The engine's Ozone platform.
#
# - `wayland` (default, CI): nested in under-wayland.sh's headless wlroots, so
#   the frame is the nested compositor's.
# - `drm`: on a real panel, so the frame is a real CRTC's. See
#   `latency_window_flags` and `latency_platform_refusal`.
#
# Neither measures presentation: the probe reads what viz drew, not the panel.
PLATFORM="${PLATFORM:-wayland}"

# Rounds, floor samples, polls per round. The control needs only three rounds;
# each poll costs a display frame, so a full budget would take minutes.
BUDGET="${BUDGET:-60,60,200}"
[ "$NEGATIVE" = "1" ] && BUDGET="${NEGATIVE_BUDGET:-3,8,6}"

# Must outlast the whole run, or a killed client reads as "never finished".
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-600}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG=$(mktemp)
COMP_LOG=$(mktemp)
CLI_LOG=$(mktemp)
LOG_COPY="${LOG_COPY:-/tmp/domicile-latency$WHICH-compositor.log}"
ENGINE_LOG_COPY="${ENGINE_LOG_COPY:-/tmp/domicile-latency$WHICH-engine.log}"
STARTED=()
cleanup() {
  cp "$COMP_LOG" "$LOG_COPY" 2>/dev/null
  cp "$ENGINE_LOG" "$ENGINE_LOG_COPY" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
  rm -rf "$PROFILE"
}
trap cleanup EXIT

REFUSAL="$(latency_platform_refusal "$PLATFORM" "${WAYLAND_DISPLAY:-}")"
[ -z "$REFUSAL" ] || {
  annotate "guard-latency: $REFUSAL"
  exit 1
}

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-latency: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-latency: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-latency: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-latency: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# One <app>, so the client's window is under the probe at the center.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform="$PLATFORM" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  "$(latency_window_flags "$PLATFORM")" \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" \
  "file://$SCRIPTS/spike-page.html?app=$APP_ID" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-latency: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  exit 1
}

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-latency.sock"
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_LATENCY=center \
DOMICILE_SPIKE_LATENCY_BUDGET="$BUDGET" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

for _ in $(seq 1 120); do
  grep -aq "wayland-[0-9]" "$COMP_LOG" 2>/dev/null && break
  kill -0 $COMP 2>/dev/null || break
  sleep 0.5
done
if ! kill -0 $COMP 2>/dev/null; then
  annotate_from "guard-latency: the compositor did not start" "$COMP_LOG"
  exit 1
fi
CLIENT_DISPLAY=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$CLIENT_DISPLAY" ] || {
  annotate "guard-latency: the compositor never named its Wayland display"
  exit 1
}

# The client flips its whole background between two colors on each Enter
# (OSC 11), so the change covers the probe pixel.
#
# `cursor_blink_interval=0`: the floor needs the screen to hold still, and a
# blinking cursor would keep it from settling (`NeverSettled`). See
# `drive_latency`.
#
# No keep-alive dots: each key press causes the next redraw.
BLINK=(-o cursor_blink_interval=0)
if [ "$NEGATIVE" = "1" ]; then
  # Redraws on its own so rounds start. Dots go top-left, away from the probe.
  CLIENT_CMD='while :; do printf .; sleep 0.2; done'
  echo "negative control: a client that answers no keys"
else
  CLIENT_CMD='a=1B3A5F; b=5F1B3A; c=$a; while read -r _; do
      if [ "$c" = "$a" ]; then c=$b; else c=$a; fi
      printf "\033]11;#%s\007" "$c"
    done'
  echo "driving kitty, flipping its background on every Enter"
fi

NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        "${BLINK[@]}" \
        -o background=#1B3A5F \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c "$CLIENT_CMD" >>"$CLI_LOG" 2>&1 &
STARTED+=($!)

# The run reports once, when it ends.
for _ in $(seq 1 300); do
  [ -n "$(latency_ended "$COMP_LOG")" ] && break
  kill -0 $COMP 2>/dev/null || break
  sleep 1
done

ENDED="$(latency_ended "$COMP_LOG")"
echo
if [ -z "$ENDED" ]; then
  # Only a commit advances a round, so a client that never redraws leaves the
  # run waiting. A terminal ignoring OSC 11 ends up here.
  # `annotate_from` takes exactly two arguments, so keep the title one string.
  annotate_from "guard-latency: the run never finished. Either the client never \
committed a frame after a key — check that it takes OSC 11 for its background \
— or the compositor stopped before it could report" "$COMP_LOG"
  echo "what the compositor said:" >&2
  grep -aE "latency|engine|frame sink|ERROR" "$COMP_LOG" | tail -15 | sed 's/^/  /' >&2
  exit 1
fi

FRAME="$(latency_display_frame "$COMP_LOG")"
FLOOR="$(latency_median floor "$COMP_LOG")"
OURS="$(latency_median "commit to pixel" "$COMP_LOG")"
THEIRS="$(latency_median "key to commit" "$COMP_LOG")"
WHOLE="$(latency_median "key to pixel" "$COMP_LOG")"
ABANDONED="$(latency_abandoned "$COMP_LOG")"
MOVED="$(latency_moved "$COMP_LOG")"
LATE="$(latency_late "$COMP_LOG")"
SOON="$(latency_soon "$COMP_LOG")"
UNDELIVERED="$(latency_undelivered "$COMP_LOG")"
REDREW="$(latency_redrew "$COMP_LOG")"
echo "ended: $ENDED; display frame ${FRAME:-none} ms; floor ${FLOOR:-none} ms;"
echo "commit to pixel ${OURS:-none} ms;"
echo "key to commit ${THEIRS:-none} ms; key to pixel ${WHOLE:-none} ms;"
echo "abandoned ${ABANDONED:-none}; moved before the answer ${MOVED:-none};"
echo "answered too late ${LATE:-none}; passed over too soon ${SOON:-none};"
echo "undelivered ${UNDELIVERED:-none};"
echo "drew again while polling ${REDREW:-none}"

if [ "$NEGATIVE" = "1" ]; then
  # The run must complete and measure the floor, or the control proves nothing.
  if [ "$ENDED" != "completed" ]; then
    annotate "guard-latency negative control: the run ended as '$ENDED' rather" \
         "than completing, so it never got as far as measuring nothing"
    exit 1
  fi
  if [ -z "$FLOOR" ]; then
    annotate "guard-latency negative control: no floor, so the probe was never" \
         "priced and the run measured nothing rather than finding nothing"
    exit 1
  fi
  if [ -n "$OURS" ]; then
    annotate "guard-latency negative control: a client that answers no keys" \
         "still produced a commit-to-pixel figure of $OURS ms — the run is" \
         "measuring something other than its own keystrokes"
    exit 1
  fi
  # Any give-up counts; which kind depends on when the client's redraw falls.
  # A commit passed over as too soon is not a give-up: the round kept waiting.
  GAVE_UP=$(( ${ABANDONED:-0} + ${MOVED:-0} + ${LATE:-0} ))
  if [ "$GAVE_UP" -lt 1 ]; then
    annotate "guard-latency negative control: no round was given up, so the" \
         "guard would not have noticed a client that answers nothing"
    exit 1
  fi
  echo "PASS: negative control: correct, a client that answers no keys is not a measurement"
  exit 0
fi

if [ "$ENDED" != "completed" ]; then
  case "$ENDED" in
    unsettled) annotate "guard-latency: the screen at the probe point never held" \
         "still, so the probe could not be priced. A client redrawing on its own" \
         "— a blinking cursor — does this; see cursor_blink_interval in this script" ;;
    dark) annotate "guard-latency: the probe stopped answering, so nothing could" \
         "be read. Either the page never embedded or the browser is not compositing" ;;
  esac
  grep -aE "latency|domicile:|ERROR" "$COMP_LOG" | tail -15 | sed 's/^/  /' >&2
  exit 1
fi

if [ "${ABANDONED:-0}" -gt 0 ]; then
  annotate "guard-latency: $ABANDONED round(s) went unanswered — the client did" \
       "not change color when a key was pressed, so what was measured is not" \
       "a keystroke reaching a pixel"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The client's answer cannot show before its commit, so a probe pixel that
# changed earlier came from a frame committed before the key. The run gives
# those rounds up.
if [ "${MOVED:-0}" -gt 0 ]; then
  annotate "guard-latency: $MOVED round(s) had the probe point change color" \
       "before the client answered, so a frame from before the keystroke is" \
       "what changed it and the run measured fewer rounds than it set out to"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# A commit long after the key is the client's own redraw, not an answer. See
# `MAX_WAIT_FRAMES` in `latency.rs`.
if [ "${LATE:-0}" -gt 0 ]; then
  annotate "guard-latency: $LATE round(s) had the client commit too long after" \
       "the key for the key to have caused it, so what would have been timed" \
       "is a redraw of the client's own and the run measured fewer rounds than" \
       "it set out to"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# A commit too soon after the key (`SOON`) is not a failure: it was already in
# flight, and the round keeps waiting. See `MIN_WAIT_FRAME_SHARE`.

# An undelivered key is a compositor failure, and would leave the median over
# fewer rounds.
if [ "${UNDELIVERED:-0}" -gt 0 ]; then
  annotate "guard-latency: $UNDELIVERED round(s) never had their key delivered," \
       "so the run measured fewer rounds than it set out to and the compositor" \
       "is what failed, not the client"
  grep -aE "latency|no surface" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

if [ -z "$OURS" ] || [ -z "$FLOOR" ] || [ -z "$FRAME" ]; then
  annotate "guard-latency: the run completed without all of a floor, a display" \
       "frame and a commit-to-pixel figure, so there is nothing to compare"
  exit 1
fi

# Check the advertised frame against the sampled floor. Load only raises the
# floor, so a frame far above the floor means the advertised frame is wrong.
if ! latency_within "$FRAME" 2 "$FLOOR"; then
  annotate "guard-latency: the run reports a display frame of ${FRAME}ms and" \
       "priced its probe at ${FLOOR}ms — a probe round trip is one display" \
       "frame, so the frame this would be measured against is not the one this" \
       "desktop is drawing at"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The assertion.
if latency_within "$OURS" "$MOST_FRAMES" "$FRAME"; then
  echo "PASS: a client's frame reaches the page in ${OURS}ms, within ${MOST_FRAMES} display frames of ${FRAME}ms."
  echo "No stage of its own, which is the claim. The probe's own floor, which"
  echo "is the same quantity sampled rather than advertised: ${FLOOR}ms."
  exit 0
fi
annotate "guard-latency: commit to pixel is ${OURS}ms against a display frame" \
     "of ${FRAME}ms, more than ${MOST_FRAMES}x — a client's frame is waiting" \
     "on a stage of its own somewhere between the commit and the page"
grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
exit 1
