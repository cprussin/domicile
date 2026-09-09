#!/usr/bin/env bash
# Keystroke to pixel, on the fork, with a real client.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-latency.sh /build/chromium/src
#
# WHY THIS EXISTS. Requirement 1 is that a client's window costs the user
# nothing a plain Wayland compositor would not have cost them, and until this
# ran nothing measured it. `css_parity.cc` measures the producer's half — a
# submit to the display compositor's output — from inside the browser. This
# measures the whole of what a user waits for: a key going into a client's seat,
# the client drawing, and the pixel arriving on the page. See `latency.rs`.
#
# WHAT IT ASSERTS, AND WHY IT IS A RATIO. The number that matters is
# `commit to pixel`, and it cannot be read as an absolute: the probe is a
# `CopyOutputRequest` that forces the draw it then reads, so every reading is at
# least one display frame and the floor measures exactly that. So the assertion
# is against the floor — this design must not add a stage of its own — which is
# also the claim ENGINE-FORK.md makes for the producer's half, in the same
# words, from the same shape of measurement.
#
# It does not assert a millisecond figure. A threshold in milliseconds is a
# threshold on whatever else the runner was doing.
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

# NEGATIVE=1 runs a client that ignores the keyboard. Every round must then be
# abandoned and the guard must fail. Without this the guard would pass on any
# client that merely draws, which is the failure `guard-two-windows.sh` shipped
# once already.
NEGATIVE="${NEGATIVE:-0}"

# How much `commit to pixel` may exceed the floor. One means "no stage of its
# own"; the runner is shared, so there is headroom. It is a ratio and not a
# duration on purpose — see the header.
MOST_FLOORS="${MOST_FLOORS:-2}"

# Three numbers: rounds, floor samples, polls per round. The control runs short
# because what it proves needs three rounds, and sixty rounds each spending
# every poll is minutes of waiting: a poll costs a display frame, because asking
# what colour a pixel is forces the draw it then reads.
#
# It is not a blocked desktop any more. The run used to sample in a loop inside
# the commit callback, which held the compositor's one thread and starved the
# client it was waiting on; it steps from a timer now and the loop keeps
# serving clients between samples. See `step_the_latency`.
BUDGET="${BUDGET:-60,60,200}"
[ "$NEGATIVE" = "1" ] && BUDGET="${NEGATIVE_BUDGET:-3,8,6}"

# Long enough for the whole run plus the browser starting. A client reaped
# mid-run stops the measurement, and the guard would report "it never finished"
# about a client that was killed.
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
}
trap cleanup EXIT

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

# The engine, on the page with one <app> on it. One, because the probe watches
# the window's centre and that is only the client's window if the client's
# window is what is under it.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
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
DOMICILE_SPIKE_LATENCY=centre \
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

# THE CLIENT, AND EVERY PART OF THIS IS LOAD-BEARING.
#
# It changes its whole background on each Enter, with OSC 11. The run watches
# one pixel for a change, so what the client redraws has to cover that pixel —
# a character printed somewhere might not, and a character printed *at* the
# probe point would be a change the run counted without the background having
# moved. Two colours alternating, because a round watches for a change from
# whatever the last one left.
#
# `cursor_blink_interval=0` is the difference between a measurement and
# nothing. The floor refuses to complete unless the screen holds still through
# the whole of it, and a blinking cursor over the probe point restarts it faster
# than it completes: the run would spend its budget and report `NeverSettled`
# having measured nothing. `drive_latency` says the same thing from the other
# side.
#
# It draws nothing between keys, and does not need to: each press causes the
# redraw that drives the next round. That is also why there are no `printf .`
# dots here as in the other guards — nothing has to keep the client committing.
BLINK=(-o cursor_blink_interval=0)
if [ "$NEGATIVE" = "1" ]; then
  # Ignores the keyboard, and redraws on its own so the run gets started and
  # can then find nothing. Its dots go to the top-left, which is not where the
  # centre is.
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

# The run reports once, at its end, whatever its end was.
for _ in $(seq 1 300); do
  [ -n "$(latency_ended "$COMP_LOG")" ] && break
  kill -0 $COMP 2>/dev/null || break
  sleep 1
done

ENDED="$(latency_ended "$COMP_LOG")"
echo
if [ -z "$ENDED" ]; then
  # A round is only advanced by a commit, so a client that answers a key with
  # no redraw at all leaves the run waiting rather than abandoning rounds — the
  # two failures of "the client did not answer" look different from here, and
  # this is the quieter one. A terminal that does not take OSC 11 for its
  # background would land exactly here.
  # One string, then the log. `annotate_from` takes exactly two arguments —
  # a title and a file — so a title split across three would have made the
  # second fragment the filename and thrown the rest away. This branch shipped
  # that once already, in `annotate`, and it read as a complete sentence.
  annotate_from "guard-latency: the run never finished. Either the client never \
committed a frame after a key — check that it takes OSC 11 for its background \
— or the compositor stopped before it could report" "$COMP_LOG"
  echo "what the compositor said:" >&2
  grep -aE "latency|engine|frame sink|ERROR" "$COMP_LOG" | tail -15 | sed 's/^/  /' >&2
  exit 1
fi

FLOOR="$(latency_median floor "$COMP_LOG")"
OURS="$(latency_median "commit to pixel" "$COMP_LOG")"
THEIRS="$(latency_median "key to commit" "$COMP_LOG")"
WHOLE="$(latency_median "key to pixel" "$COMP_LOG")"
ABANDONED="$(latency_abandoned "$COMP_LOG")"
UNDELIVERED="$(latency_undelivered "$COMP_LOG")"
REDREW="$(latency_redrew "$COMP_LOG")"
echo "ended: $ENDED; floor ${FLOOR:-none} ms; commit to pixel ${OURS:-none} ms;"
echo "key to commit ${THEIRS:-none} ms; key to pixel ${WHOLE:-none} ms;"
echo "abandoned ${ABANDONED:-none}; undelivered ${UNDELIVERED:-none};"
echo "drew again while polling ${REDREW:-none}"

if [ "$NEGATIVE" = "1" ]; then
  # A control that passes because the whole run fell over proves nothing: the
  # run has to have got as far as pricing the probe and pressing keys, and only
  # then found nothing.
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
  if [ "${ABANDONED:-0}" -lt 1 ]; then
    annotate "guard-latency negative control: no round was abandoned, so the" \
         "guard would not have noticed a client that answers nothing"
    exit 1
  fi
  echo "negative control: correct, a client that answers no keys is not a measurement"
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
       "not change colour when a key was pressed, so what was measured is not" \
       "a keystroke reaching a pixel"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The other half of that, and a different end: a round whose key this
# compositor never delivered. The median would be over whatever rounds
# survived, which is a number about a smaller run than the one reported.
if [ "${UNDELIVERED:-0}" -gt 0 ]; then
  annotate "guard-latency: $UNDELIVERED round(s) never had their key delivered," \
       "so the run measured fewer rounds than it set out to and the compositor" \
       "is what failed, not the client"
  grep -aE "latency|no surface" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

if [ -z "$OURS" ] || [ -z "$FLOOR" ]; then
  annotate "guard-latency: the run completed without both a floor and a" \
       "commit-to-pixel figure, so there is nothing to compare"
  exit 1
fi

# The assertion. Everything above is about having a measurement at all.
if latency_within "$OURS" "$MOST_FLOORS" "$FLOOR"; then
  echo "PASS: a client's frame reaches the page in ${OURS}ms against a probe"
  echo "floor of ${FLOOR}ms — no stage of its own, which is the claim."
  exit 0
fi
annotate "guard-latency: commit to pixel is ${OURS}ms against a floor of" \
     "${FLOOR}ms, more than ${MOST_FLOORS}x — a client's frame is waiting on a" \
     "stage of its own somewhere between the commit and the page"
grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
exit 1
