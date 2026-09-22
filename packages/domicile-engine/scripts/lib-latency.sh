#!/usr/bin/env bash
# Reading a latency run out of the compositor's log.
#
# Its own file, sourced by `guard-latency.sh` and by
# `scripts/test-latency-report.sh`, for the reason `lib-annotate.sh` is its own
# file: what a guard concludes from a log is the guard's actual behavior, and
# behavior that can only be exercised by starting a browser is behavior
# nobody exercises. Everything here is a string in and a string out.
#
# The lines these read are built by `Spread::line` in the compositor's
# `latency.rs` and asserted whole by its unit tests, so the two ends of this
# contract are pinned from both sides.

# The median, in milliseconds, off one `latency <what>:` line.
#
# Empty when the line is absent or says "nothing measured", which are different
# facts about a run but the same fact about this: there is no number to compare.
# The caller decides what that means; every caller here treats it as failure.
#
# The LAST line for this label, whatever it says, and then a number out of it —
# rather than the last line that happens to have a number in it. The difference
# shows up on a run that measured something and then measured nothing: anchored
# on `min `, "nothing measured" is invisible and the stale earlier number is
# what comes back, which is a reading presented for a run that had none.
#
# The median is bounded by `, max ` on the way out because the line ends
# `(median 1.0 frames)` and an unbounded `median [0-9.]*` takes that instead.
latency_median() {
  local what="$1" log="$2"
  grep -a "latency $what: " "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*median \([0-9.]*\), max .*/\1/p'
}

# One display frame, in milliseconds, as the run reported it. Empty when the
# run never said, which every caller here treats as failure.
#
# THIS IS WHAT THE GUARD'S ASSERTION IS A MULTIPLE OF, and the floor is not.
# Both are the same quantity -- a probe round trip is one display frame,
# because asking what color a pixel is forces the draw it then reads -- but
# only one of them is measured while the browser is busy starting. `floor` has
# come back at 48.71 ms on a run whose own `commit to pixel` was 29.18, and a
# denominator larger than a number quantized to it is not that number's floor.
#
# It is the interval `Spread::line` divides by for its `(median N frames)`
# column, so the guard's ratio and the compositor's own frame counts are the
# same arithmetic on the same number.
latency_display_frame() {
  local log="$1"
  grep -a "latency: the display frame is " "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*the display frame is \([0-9.]*\) ms.*/\1/p'
}

# How a run ended, as one word: `completed`, `unsettled`, `dark`, or empty when
# the run never said.
#
# Three outcomes rather than a boolean because they blame different things —
# see `Ended` in `latency.rs` — and a guard that collapsed them would report a
# blinking cursor and a broken probe with the same sentence.
latency_ended() {
  local log="$1"
  if grep -aq "latency: the run completed" "$log" 2>/dev/null; then
    echo completed
  elif grep -aq "latency: the run gave up — the screen" "$log" 2>/dev/null; then
    echo unsettled
  elif grep -aq "latency: the run gave up — the probe" "$log" 2>/dev/null; then
    echo dark
  fi
}

# How many rounds the client left unanswered. Empty when the run never said.
latency_abandoned() {
  local log="$1"
  grep -a "round(s) abandoned by the client" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# How many rounds the client answered with more than one frame. Empty when the
# run never said.
#
# Not a fault, and not read as one. It qualifies `commit to pixel`, which is
# timed from the first of those frames, and it is the number that tells an
# abandoned round apart from a starved one: see `step_the_latency`.
latency_redrew() {
  local log="$1"
  grep -a "round(s) where the client drew again while polling" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# How many rounds were given up because the probe point changed color before
# the client answered. Empty when the run never said.
#
# Its own reader, and its own accusation again: the client was asked and the
# screen moved anyway, which means a frame from before the key reached it. The
# round is not a measurement and is not counted as one — so a guard that read
# only `abandoned` would report a run as whole while it measured fewer rounds
# than it set out to.
latency_moved() {
  local log="$1"
  grep -a "round(s) whose pixel moved before the client answered" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# How many rounds were given up because the client's commit came too long after
# the key to be its answer. Empty when the run never said.
#
# Its own reader, and the accusation that reads least like one: the client
# committed, in order, and the pixel followed. What is wrong with the round is
# the size of the wait — a client redrawing on its own committed whatever it
# was doing, and the round still waiting took it for an answer.
latency_late() {
  local log="$1"
  grep -a "round(s) whose commit came too late to be the key's answer" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# How many rounds were given up because the client's commit came too soon after
# the key to be its answer. Empty when the run never said.
#
# The near end of the wait the reader above reads the far end of, and its own
# reader because it is its own reading: a commit 0.82 ms after a key is a frame
# the client already had in flight, and reporting it as a slow answer would
# send whoever read it to the wrong end. Anchored on the whole sentence, since
# the two lines differ by one word.
latency_soon() {
  local log="$1"
  grep -a "round(s) whose commit came too soon to be the key's answer" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# How many rounds this compositor failed to deliver a key for. Empty when the
# run never said.
#
# Its own reader because it is its own accusation: an abandoned round is the
# client not answering, and one of these is us never asking. A guard that read
# only `abandoned` would pass a run where most rounds measured and the rest
# never happened, over a median of whatever was left.
latency_undelivered() {
  local log="$1"
  grep -a "round(s) whose key was never delivered" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Whether `$1` is at most `$2` times `$3`, in floating point.
#
# `awk` because these are milliseconds with two decimals and `[` compares
# integers: `[ 16.68 -le 33.34 ]` is not a comparison, it is a syntax error,
# and the shape that silently is not one — `${x%.*}` — throws away exactly the
# precision this is about.
#
# False for an empty or unparseable operand rather than true. A threshold check
# that passes when it could not read the numbers is worse than no check.
latency_within() {
  local got="$1" times="$2" of="$3"
  awk -v got="$got" -v times="$times" -v of="$of" 'BEGIN {
    if (got == "" || of == "" || got + 0 != got || of + 0 != of) { exit 1 }
    exit (got <= times * of) ? 0 : 1
  }'
}

# The flags that ask for the engine's window on `$1`.
#
# The one thing that differs between the two readings of this run. A nested run
# gets a window of a stated size, because it is a window in somebody else's
# session and nothing else decides how big it is.
#
# THE SCANOUT PLATFORM GETS NO SIZE AT ALL, and that is not a preference.
# `ScreenManager::UpdateControllerToWindowMapping` pairs a window with a
# controller through `FindWindowAt`, which compares an EXACT rectangle against
# the controller's origin and mode size (`screen_manager.cc:1001`). No match
# means the window is given no controller, every page flip is dropped before it
# reaches the kernel, and the CRTC keeps the blank buffer the modeset put up —
# a black screen with a clean log, which is how the first desktop on real
# hardware came up. `--start-fullscreen` is what makes the window the CRTC's
# rectangle; `domicile-launch`'s `spawn.rs` adds it on the same platform for
# the same reason, and this is the guard agreeing with that rather than
# deciding it a second time.
latency_window_flags() { # platform
  case "$1" in
    (drm) printf -- '--start-fullscreen' ;;
    (*) printf -- '--window-size=1024,768' ;;
  esac
}

# Why this platform cannot be run from where this is being run from, or
# nothing.
#
# Each of the two readings is wrong in the other's place, and neither says so
# on its own. `drm` inside a session cannot take DRM master, because the
# session already holds it — what that looks like is a GPU process dying,
# minutes into a run that had already started a browser and a compositor.
# `wayland` with no session has no compositor to be a client of, which is
# `under-wayland.sh` having been forgotten and is the ordinary way this gets
# run wrongly.
#
# Refused before anything starts rather than diagnosed afterwards, for the
# reason `ERRORS.md` gives: the alternative is a run that fails somewhere else
# and says something about a socket.
latency_platform_refusal() { # platform, WAYLAND_DISPLAY
  local platform="$1" session="${2:-}"
  if [ "$platform" = "drm" ] && [ -n "$session" ]; then
    printf '%s' "PLATFORM=drm takes DRM master, and WAYLAND_DISPLAY=$session says this is already inside a session holding it. Run it from a console login, and not under under-wayland.sh."
  elif [ "$platform" != "drm" ] && [ -z "$session" ]; then
    printf '%s' "PLATFORM=$platform needs a Wayland session to be a client of, and there is no WAYLAND_DISPLAY. Wrap this in under-wayland.sh, or take the run on a console login with PLATFORM=drm."
  fi
}
