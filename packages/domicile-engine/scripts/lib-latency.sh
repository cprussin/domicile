#!/usr/bin/env bash
# Parses a latency run from the compositor's log.
#
# Sourced by `guard-latency.sh` and `scripts/test-latency-report.sh`, so the
# parsing is testable without starting a browser. Each function takes strings
# and returns a string.
#
# The lines come from `Spread::line` in the compositor's `latency.rs`, whose
# unit tests assert their exact format.

# The median in milliseconds from the last `latency <what>:` line.
#
# Empty when the line is absent or says "nothing measured"; callers treat that
# as failure.
#
# Reads the last line for the label, then extracts the number. Matching the
# last line that has a number would return a stale value when a later line
# says "nothing measured".
#
# `, max ` bounds the match: the line ends `(median 1.0 frames)`, which an
# unbounded `median [0-9.]*` would match instead.
latency_median() {
  local what="$1" log="$2"
  grep -a "latency $what: " "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*median \([0-9.]*\), max .*/\1/p'
}

# One display frame in milliseconds, as the run reported it. Empty when
# missing; callers treat that as failure.
#
# The guard's threshold is a multiple of this, not of `floor`. Both should be
# one frame, but `floor` is measured while the browser is starting and runs
# high (48.71 ms on a run whose `commit to pixel` was 29.18).
#
# `Spread::line` divides by the same interval for its `(median N frames)`
# column.
latency_display_frame() {
  local log="$1"
  grep -a "latency: the display frame is " "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*the display frame is \([0-9.]*\) ms.*/\1/p'
}

# How a run ended: `completed`, `unsettled`, `dark`, or empty if not reported.
#
# Each outcome points at a different cause; see `Ended` in `latency.rs`.
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

# Rounds the client left unanswered. Empty when not reported.
latency_abandoned() {
  local log="$1"
  grep -a "round(s) abandoned by the client" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Rounds the client answered with more than one frame. Empty when not
# reported.
#
# Not a fault. `commit to pixel` is timed from the first of those frames. This
# count tells an abandoned round from a starved one; see `step_the_latency`.
latency_redrew() {
  local log="$1"
  grep -a "round(s) where the client drew again while polling" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Rounds dropped because the probe pixel changed before the client answered,
# i.e. a frame from before the key reached it. Empty when not reported.
#
# Read separately because these rounds are not counted as measurements; a guard
# reading only `abandoned` would miss them.
latency_moved() {
  local log="$1"
  grep -a "round(s) whose pixel moved before the client answered" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Rounds dropped because the client's commit came too long after the key to be
# its answer. Empty when not reported.
#
# Typically a client redrawing on its own: the commit was unrelated to the key.
latency_late() {
  local log="$1"
  grep -a "round(s) whose commit came too late to be the key's answer" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Commits skipped for arriving too soon after the key to be its answer. Empty
# when not reported.
#
# Counted in commits, not rounds: such a commit (e.g. 0.82 ms after the key)
# was already in flight, and the round keeps waiting for the real answer.
latency_soon() {
  local log="$1"
  grep -a "commit(s) passed over for coming too soon to be the key's answer" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) commit(s).*/\1/p'
}

# Rounds whose key the compositor never delivered. Empty when not reported.
#
# Read separately from `abandoned` (client did not answer): without it, a run
# where some rounds never happened would pass on the remaining median.
latency_undelivered() {
  local log="$1"
  grep -a "round(s) whose key was never delivered" "$log" 2>/dev/null |
    tail -1 |
    sed -n 's/.*latency: \([0-9]*\) round(s).*/\1/p'
}

# Whether `$1` <= `$2` * `$3`, in floating point.
#
# `awk` because `[` compares integers only, and truncating with `${x%.*}`
# loses the precision being compared.
#
# False for an empty or unparseable operand, so an unreadable number fails the
# check.
latency_within() {
  local got="$1" times="$2" of="$3"
  awk -v got="$got" -v times="$times" -v of="$of" 'BEGIN {
    if (got == "" || of == "" || got + 0 != got || of + 0 != of) { exit 1 }
    exit (got <= times * of) ? 0 : 1
  }'
}

# The engine's window flags for platform `$1`.
#
# Nested runs get a fixed size. The `drm` platform must get
# `--start-fullscreen` instead: `ScreenManager::UpdateControllerToWindowMapping`
# matches a window to a controller only on an exact rectangle
# (`FindWindowAt`, `screen_manager.cc:1001`). Without a match, page flips are
# dropped and the screen stays black with a clean log. `domicile-launch`'s
# `spawn.rs` adds the same flag for the same reason.
latency_window_flags() { # platform
  case "$1" in
    (drm) printf -- '--start-fullscreen' ;;
    (*) printf -- '--window-size=1024,768' ;;
  esac
}

# Why this platform cannot run in the current environment, or nothing.
#
# `drm` inside a session cannot take DRM master; the GPU process dies minutes
# later. `wayland` without a session has no compositor; usually
# `under-wayland.sh` was forgotten. Refuse up front instead of failing later
# with an unrelated socket error (see `docs/guidelines/ERRORS.md`).
latency_platform_refusal() { # platform, WAYLAND_DISPLAY
  local platform="$1" session="${2:-}"
  if [ "$platform" = "drm" ] && [ -n "$session" ]; then
    printf '%s' "PLATFORM=drm takes DRM master, and WAYLAND_DISPLAY=$session says this is already inside a session holding it. Run it from a console login, and not under under-wayland.sh."
  elif [ "$platform" != "drm" ] && [ -z "$session" ]; then
    printf '%s' "PLATFORM=$platform needs a Wayland session to be a client of, and there is no WAYLAND_DISPLAY. Wrap this in under-wayland.sh, or take the run on a console login with PLATFORM=drm."
  fi
}
