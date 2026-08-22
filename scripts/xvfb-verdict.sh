#!/usr/bin/env bash
# Why Xvfb gave a caller no display, in Xvfb's own words.
#
# Its own file because `check.sh` runs the moment it is sourced — there is no
# way to reach a function inside it without running every check in the repo —
# and this is the sentence a red CI run is read for. `scripts/test-xvfb-
# verdict.sh` sources this and nothing else.

# Two answers, and the difference between them is the whole diagnosis: a server
# that died has something to say and an exit status to say it with, and a
# server still running when the deadline passed has not finished starting.
# Watching only the clock, as `check.sh` used to, cannot tell those apart and
# reports both as silence.
#
# The deadline is a parameter rather than a global the caller happens to have
# set, so the sentence depends on nothing but its three arguments.
xvfb_verdict() {
  local pid="$1" log="$2" deadline="$3" said status
  # Onto one line, because this ends up inside a one-line verdict. A server
  # that said nothing must end up with nothing rather than with a space, or
  # every silent failure grows an empty `it said:`.
  said="$(tr -s '[:space:]' ' ' <"$log" | sed 's/ *$//')"
  if kill -0 "$pid" 2>/dev/null; then
    printf 'Xvfb named no display in %ss%s' "$deadline" "${said:+ — it said: $said}"
  else
    # Only ever reached after a `kill -0` that failed, which means the shell
    # has already reaped this child and recorded its status — so this returns
    # the status rather than blocking or answering 127, even from inside the
    # command substitution the caller wraps it in.
    wait "$pid"; status=$?
    printf 'Xvfb exited %s%s' "$status" "${said:+ — it said: $said}"
  fi
}
