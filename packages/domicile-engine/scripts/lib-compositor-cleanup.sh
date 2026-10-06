#!/usr/bin/env bash
# Stops every process of a nested compositor, not only the one `$!` names.
#
#   . "$SCRIPTS/lib-compositor-cleanup.sh"
#   compositor_env                          # env to exec the compositor through
#   kill_compositors "$(compositor_owner)"  # this run's, at exit
#   kill_compositors                        # at startup: leftovers
#
# nixpkgs' sway wrapper execs `dbus-run-session`, which forks dbus-daemon and
# sway. `kill $!` stops only dbus-run-session and orphans sway, swaybg and the
# bus. Leaked compositors hold memory and EGL contexts on the render node that
# later guards measure.
#
# Processes are found by environment: `DOMICILE_COMPOSITOR=<pid>:<start time>`
# is set on the compositor's `env` only, so the bus, sway and swaybg inherit it
# and the caller's other children do not. /proc/<pid>/environ holds the exec
# environment, so it cannot change while read. Child walks miss orphans, and
# process group ids can be reused.
#
# The owner is a pid plus its start time, read from /proc, because a pid alone
# can be reused. Variables exported by the running shell do not appear in its
# /proc environ, so they cannot mark ownership.
#
# XDG_RUNTIME_DIR alone does not separate runs: crux's two runners share a user
# and, through PrivateTmp, the same XDG_RUNTIME_DIR path. A sweep that ignored
# owner liveness would kill the other job's live compositor.
#
# Each rule protects a compositor that may be in use; each has a case in
# `scripts/test-under-wayland-cleanup.sh`:
#
#   - a run kills its own compositor only by its owner marker;
#   - the leftover sweep spares compositors whose owner (pid and start time)
#     is still running;
#   - only compositors with this XDG_RUNTIME_DIR are considered;
#   - SIGTERM first (sway takes swaybg with it; the bus exits on its own),
#     then SIGKILL so cleanup cannot hang.

# Counts a newline-separated list of pids.
compositor_count() {
  printf '%s\n' "$1" | grep -c .
}

# A pid's start time in clock ticks since boot (field 22 of /proc/<pid>/stat),
# or empty if no process holds the pid.
#
# Strips through the last `) ` first, because field 2 (the executable name) may
# contain spaces or parentheses. The rest starts at field 3, so field 22 is
# word 20.
#
# The brace group also silences the shell's own error when the pid exits
# mid-scan; `2>` on `cat` does not cover a failed redirection.
process_start_time() {
  local stat
  stat="$( { cat "/proc/$1/stat"; } 2>/dev/null )"
  printf '%s\n' "${stat##*) }" | awk '{ print $20 }'
}

# This run's owner marker: `<pid>:<start time>`, unique across live and dead
# runs.
compositor_owner() {
  printf '%s:%s\n' "$$" "$(process_start_time "$$")"
}

# The `env` words that mark a compositor as this run's. The caller adds the
# rest of the compositor's environment.
compositor_env() {
  printf '%s\n' "DOMICILE_COMPOSITOR=$(compositor_owner)"
}

# Whether the marker's owner is alive: its pid exists with the same start
# time, so a reused pid does not count.
owner_is_running() {
  [ "$(process_start_time "${1%%:*}")" = "${1#*:}" ]
}

# With an owner marker: that owner's compositor processes. Without one: every
# compositor process whose owner has exited.
compositor_pids() {
  local want="${1:-}" entry pid environ owner
  for entry in /proc/[0-9]*; do
    pid="${entry#/proc/}"
    [ "$pid" = "$$" ] && continue
    environ="$( { tr '\0' '\n' < "$entry/environ"; } 2>/dev/null )"
    [ -n "$environ" ] || continue
    owner="$(printf '%s\n' "$environ" | sed -n 's/^DOMICILE_COMPOSITOR=//p')"
    [ -n "$owner" ] || continue
    printf '%s\n' "$environ" |
      grep -Fqx "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" || continue
    if [ -n "$want" ]; then
      [ "$owner" = "$want" ] || continue
    elif owner_is_running "$owner"; then
      continue
    fi
    printf '%s\n' "$pid"
  done
}

# Stops the matching compositors and logs it, so a leak shows in the step log.
kill_compositors() {
  local want="${1:-}" pids left="" attempt
  pids="$(compositor_pids "$want")"
  [ -n "$pids" ] || return 0
  if [ -n "$want" ]; then
    echo "stopping this run's compositor: $(compositor_count "$pids") processes" >&2
  else
    echo "a previous run left $(compositor_count "$pids") compositor processes behind" >&2
  fi
  # shellcheck disable=SC2086 # a list of pids is exactly what kill takes
  kill -TERM $pids 2>/dev/null
  # Up to five seconds.
  for attempt in $(seq 1 25); do
    left="$(compositor_pids "$want")"
    [ -n "$left" ] || return 0
    sleep 0.2
  done
  echo "$(compositor_count "$left") would not take SIGTERM in five seconds, killing" >&2
  # shellcheck disable=SC2086 # as above
  kill -KILL $left 2>/dev/null
}
