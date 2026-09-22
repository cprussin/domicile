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
# least one display frame and is quantized to it. So the assertion is that it is
# within a small number of display frames — this design must not add a stage of
# its own — which is also the claim ENGINE-FORK.md makes for the producer's
# half, in the same words, from the same shape of measurement.
#
# It does not assert a millisecond figure. A threshold in milliseconds is a
# threshold on whatever else the runner was doing.
#
# THE FRAME IS THE DENOMINATOR, AND THE FLOOR USED TO BE. Both are the same
# quantity -- one probe round trip is one display frame -- and only one of them
# is sampled, at the start of a run, while a browser and a client are still
# starting. Four CI runs of this guard, and the control's own floor beside the
# one that has it:
#
#   floor 48.71 ms   commit to pixel 29.18 ms   ratio 0.60
#   floor 16.43 ms   commit to pixel 27.99 ms   ratio 1.70   (control: 32.49)
#   floor 16.69 ms   commit to pixel 28.18 ms   ratio 1.69   (control: 39.19)
#   floor 16.55 ms   commit to pixel 28.24 ms   ratio 1.71   (control: 31.82)
#
# `commit to pixel` moves by four per cent across all of them. The floor moves
# by three times, and it was the number the bar was built from -- so the guard
# was a coin toss between 0.60 and 1.71 against a threshold of 2, and it would
# have flaked reading like a regression. The 48.71 sample is not merely noisy,
# it is impossible: `commit to pixel` is quantized to probe round trips and can
# never be less than one, and that run's was 29.18. Whatever those samples
# priced, it was not a probe round trip.
#
# So the run's own reported display frame is the denominator. It is not a
# millisecond threshold in disguise -- it is this desktop's frame period, the
# same number `Spread::line` divides by for its `(median N frames)` column, and
# a desktop advertising 144Hz moves the bar with it. What it stops being is a
# bar that moves with whatever the runner was doing during the samples that
# priced the probe, which is worse than noise in a reading: it moves the bar
# rather than the measurement.
#
# AND THE ADVERTISED FRAME IS THE REAL ONE HERE, which is the objection this
# has to answer, because `display_interval` cannot ask viz. `css_parity.cc`
# can -- it runs inside the browser and reads `BeginFrameArgs` -- and in the
# same CI job as the fourth row above it reported
#
#   display frame interval, per viz     16.67 ms
#   probe round trip, nothing changed   min 13.47, median 16.75, max 21.11 ms
#                                       (median 1.0 frames)
#
# against the 16.67 ms this compositor advertises. Two instruments, one from
# inside the browser and one from outside it, agreeing on the frame and on the
# round trip being one of them. That min is also why the floor's own minimum
# is not the denominator either: a sample can come in under a frame.
#
# The threshold itself is untouched at 2. Widening it is how this would have
# been made to stop failing rather than made to mean something, and a stage of
# its own -- a readback, an extra composite, a frame held for a queue -- is one
# more display frame, which 2 still catches with the readings above sitting at
# 1.7.
#
# THE FLOOR IS STILL READ, and it still has a job: the display frame is what
# the compositor *advertises* (`display_interval` says so, because nothing
# outside the browser can ask viz), and the floor is that same quantity
# measured. A frame far larger than the floor means the bar is built from a
# number this display is not running at, and the guard says so instead of
# comparing against it.
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

# NEGATIVE=1 runs a client that ignores the keyboard. No round may then produce
# a figure, and the guard must fail. Without this the guard would pass on any
# client that merely draws, which is the failure `guard-two-windows.sh` shipped
# once already.
#
# It has already earned its keep. The control's client answers no keys and
# still redraws, so a round was started by a commit the key had not caused, and
# the run was not watching the probe point between the press and that commit —
# so a color change that arrived during the wait was priced as the keystroke's.
# One round in three, about half the runs. The control said the guard was
# measuring something other than its own keystrokes, and it was right: the run
# watches that wait now, and gives the round up instead. See `latency.rs`.
#
# And then it earned it twice. Watching the wait catches a pixel that moved
# before the commit; it says nothing about a commit that arrives in the right
# order and far too late. The control's next failure was a dot committing
# 914.87 ms after the key — 55 display frames — with its pixels one frame
# behind it, which is `key -> commit -> pixel` with every number positive. The
# run brackets how long after the key a commit may arrive and still count, in
# display frames, and gives the round up outside it: `MAX_WAIT_FRAMES` and
# `MIN_WAIT_FRAME_SHARE`.
#
# AND THEN IT EARNED IT A THIRD TIME, BY SHOWING THAT THE BRACKET IS NOT A
# SEPARATOR. The control's next failure was a dot committing 121.95 ms after
# the key — 7.3 frames, inside a bound of eight — which looked like a number
# that needed tightening. It is not. Every commit either run has ever accepted
# as a key's answer, in frames:
#
#   a client that answers keys, 180 rounds   0.96 .. 2.69
#   the control's, which answers none        0.05, 0.92, 0.97, 2.48, 7.31
#
# Three of the control's five sit inside the range real answers occupy, so no
# bound on the wait tells one population from the other. What the bracket does
# is trim the implausible ends, which makes this control a statistical one: it
# asserts that no round produced a figure, and how often that holds is a matter
# of where a stray redraw happens to land. Making it deterministic needs a
# different discriminator — the client's answer identified by the color it was
# asked to draw, the way `guard-client-window.sh` now waits for its client's
# own color rather than for any change — and that is not this bracket's job.
NEGATIVE="${NEGATIVE:-0}"

# How many display frames `commit to pixel` may take. One means "no stage of
# its own"; the probe is only asked after the commit and each ask costs a
# frame, so a clean run lands between one and two and every reading there has
# been sits at 1.7. Two is where a stage of its own starts. It is a count of
# frames and not a duration on purpose — see the header.
MOST_FRAMES="${MOST_FRAMES:-2}"

# Three numbers: rounds, floor samples, polls per round. The control runs short
# because what it proves needs three rounds, and sixty rounds each spending
# every poll is minutes of waiting: a poll costs a display frame, because asking
# what color a pixel is forces the draw it then reads.
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
# the window's center and that is only the client's window if the client's
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

# THE CLIENT, AND EVERY PART OF THIS IS LOAD-BEARING.
#
# It changes its whole background on each Enter, with OSC 11. The run watches
# one pixel for a change, so what the client redraws has to cover that pixel —
# a character printed somewhere might not, and a character printed *at* the
# probe point would be a change the run counted without the background having
# moved. Two colors alternating, because a round watches for a change from
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
  # center is.
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
echo "answered too late ${LATE:-none}; answered too soon ${SOON:-none};"
echo "undelivered ${UNDELIVERED:-none};"
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
  # Any of the four, because what the control asserts is that the guard gave
  # rounds up rather than which bucket they landed in. The client answers no
  # keys, so whether a round ends as abandoned, as a pixel that moved before
  # the answer, or as a commit too late or too soon to be one is decided by
  # where the client's own redraw happened to fall — and a control reading only
  # the bucket that happened to be empty would fail as a flake rather than a
  # finding. The assertion is unchanged: no figure, and the guard noticed.
  GAVE_UP=$(( ${ABANDONED:-0} + ${MOVED:-0} + ${LATE:-0} + ${SOON:-0} ))
  if [ "$GAVE_UP" -lt 1 ]; then
    annotate "guard-latency negative control: no round was given up, so the" \
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
       "not change color when a key was pressed, so what was measured is not" \
       "a keystroke reaching a pixel"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The third, and the one the negative control caught by failing. Nothing the
# client draws in answer can reach the screen before the commit the round is
# waiting for, so a probe point that changed color before that commit was
# changed by a frame committed before the key. The run gives those rounds up
# rather than timing them from whichever commit came next — that is what used
# to produce a commit-to-pixel figure out of a client answering nothing — and
# each one costs the run a round the median is then not over.
if [ "${MOVED:-0}" -gt 0 ]; then
  annotate "guard-latency: $MOVED round(s) had the probe point change color" \
       "before the client answered, so a frame from before the keystroke is" \
       "what changed it and the run measured fewer rounds than it set out to"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The fourth, and the one the negative control caught by failing a second time
# after the check above shipped. The client committed, in the right order, and
# the pixel followed a frame later — 55 display frames after the key, against a
# worst real round of 2.6 over sixty. A client redrawing on its own commits for
# reasons the key had nothing to do with, and the round still waiting takes
# that commit for its answer; the run bounds the wait now and gives the round
# up instead. See `MAX_WAIT_FRAMES` in `latency.rs`.
if [ "${LATE:-0}" -gt 0 ]; then
  annotate "guard-latency: $LATE round(s) had the client commit too long after" \
       "the key for the key to have caused it, so what would have been timed" \
       "is a redraw of the client's own and the run measured fewer rounds than" \
       "it set out to"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The near end of that same wait, and its own sentence rather than more of the
# one above. A commit 0.82 ms after the key is not a slow answer, it is a frame
# the client already had in flight when the key landed — the same stray, caught
# arriving with the key instead of long after it. See `MIN_WAIT_FRAME_SHARE`.
if [ "${SOON:-0}" -gt 0 ]; then
  annotate "guard-latency: $SOON round(s) had the client commit too soon after" \
       "the key for the key to have caused it, so what would have been timed" \
       "is a frame the client already had in flight and the run measured fewer" \
       "rounds than it set out to"
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

if [ -z "$OURS" ] || [ -z "$FLOOR" ] || [ -z "$FRAME" ]; then
  annotate "guard-latency: the run completed without all of a floor, a display" \
       "frame and a commit-to-pixel figure, so there is nothing to compare"
  exit 1
fi

# WHETHER THE BAR IS A BAR, before anything is measured against it. The frame
# is advertised and the floor is the same thing sampled, so the floor is the
# only check there is on the advertisement — and it can only fail in one
# direction, because contention pushes a sampled floor up and nothing pushes it
# below one frame.
if ! latency_within "$FRAME" 2 "$FLOOR"; then
  annotate "guard-latency: the run reports a display frame of ${FRAME}ms and" \
       "priced its probe at ${FLOOR}ms — a probe round trip is one display" \
       "frame, so the frame this would be measured against is not the one this" \
       "desktop is drawing at"
  grep -aE "latency" "$COMP_LOG" | tail -8 | sed 's/^/  /' >&2
  exit 1
fi

# The assertion. Everything above is about having a measurement at all.
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
