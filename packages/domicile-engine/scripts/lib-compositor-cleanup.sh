#!/usr/bin/env bash
# Stopping a nested compositor means stopping all of it.
#
#   . "$SCRIPTS/lib-compositor-cleanup.sh"
#   compositor_env                          # what to exec the compositor through
#   kill_compositors "$(compositor_owner)"  # this run's, at exit
#   kill_compositors                        # at startup: whatever is left over
#
# WHAT LEAKED, AND WHY IT IS NOT THE PID THE SHELL HAS. `kill "$COMPOSITOR"`
# reaches exactly one process, and it is not sway. nixpkgs' sway wrapper execs
# `dbus-run-session`, and that *forks* both the bus and sway so that it can
# shut the bus down once sway is gone — so the pid a `&` hands back here
# belongs to the bookkeeper, and SIGTERM to the bookkeeper orphans the work.
# Measured on crux mid-job, the compositor that was in use looked like this:
#
#   ├─1477006 bash .../under-wayland.sh /build/chromium/src …guard-latency.sh
#   ├─1477034 dbus-run-session .../sway -c /build/tmp/nix-shell.pM8I4W/tmp.…
#   ├─1477058 dbus-daemon --nofork --print-address 4 --session
#   ├─1477061 .../sway -c /build/tmp/nix-shell.pM8I4W/tmp.…
#   └─1477066 .../swaybg
#
# — with no `nix` and no `env` in it, because `nix shell --command` execs —
# and above it sat eight {dbus-daemon, sway, swaybg} triples with no
# dbus-run-session over any of them. Eight is exactly the number of
# under-wayland.sh steps that job had already finished. So this leaked one
# compositor per step, every step, whether the step passed or failed: eight
# idle compositors by the end, 11.9G resident on the unit, each still holding
# an EGL context on the render node the guards are measured against — and the
# step running beside them was guard-latency.sh, whose whole output is a
# number of milliseconds.
#
# HOW THE REST OF IT IS FOUND. Not by walking children: the processes worth
# killing are the ones with no parent left. Not by process group either — a
# group kill wants a group of this run's own, and a dead group's id can belong
# to somebody else by the time anything looks. What is left is the environment:
# `DOMICILE_COMPOSITOR` goes on the `env` that becomes the compositor and on
# nothing else, so the bus, sway and swaybg inherit it and the guard the
# calling script goes on to run does not. /proc/<pid>/environ is what a process
# was exec'd with, so it cannot drift while this reads it.
#
# WHAT NAMES A RUN, AND WHY IT IS NOT A VARIABLE THE RUN EXPORTS. This used to ask
# whether the starter still carried `DOMICILE_UNDER_WAYLAND=<its own pid>`, and
# that question could never be answered yes: /proc/<pid>/environ is what a
# process was exec'd with, and under-wayland.sh exports that marker and goes on
# as the same shell, so the variable is in its environment and not in its
# `environ`. So the sweep read every live run as a run that had gone, and
# collected its compositor. crux hosts two runners as one user, and
# `PrivateTmp` gives them the same XDG_RUNTIME_DIR path over two different
# directories, so that did not separate them either: one job's startup sweep
# SIGTERMed the other job's compositor mid-run, and the engine died on a broken
# pipe forty seconds in, before its client had appeared. What names a run here
# is its pid and the moment that pid started, which is read from outside the
# process — so there is nothing left for the process to have failed to publish.
#
# EVERY WAY THIS CAN BE WRONG IS A COMPOSITOR SOMEBODY IS USING, so each of
# them has a rule and `scripts/test-under-wayland-cleanup.sh` has a case:
#
#   - the marker names the run that started the compositor, so a run only ever
#     collects its own by name;
#   - the leftover sweep spares anything whose starter is still running, which
#     it decides by the pid *and* the start time the marker names — a pid alone
#     answers yes for whatever process inherited that number next;
#   - it is scoped to one XDG_RUNTIME_DIR, so a run pointed somewhere else is
#     none of its business;
#   - and SIGTERM first, because sway takes swaybg with it and the bus goes on
#     its own. The second pass exists only so that one that will not go cannot
#     turn cleanup into a hang.

# How many processes a newline-separated list of pids is.
compositor_count() {
  printf '%s\n' "$1" | grep -c .
}

# When the process holding a pid started, in clock ticks since boot, and
# nothing at all for a pid no process holds. Field 22 of /proc/<pid>/stat.
#
# Everything through the last `) ` goes first because field 2 is the
# executable's name, and a name is allowed a space or a parenthesis of its own
# — which would shift every field after it. What is left begins at field 3, so
# field 22 is the twentieth word of it.
#
# The brace group so that the shell's own "no such process" for a pid that went
# away mid-scan is suppressed too: a `2>` on `cat` does not cover a redirection
# the shell could not open in the first place.
process_start_time() {
  local stat
  stat="$( { cat "/proc/$1/stat"; } 2>/dev/null )"
  printf '%s\n' "${stat##*) }" | awk '{ print $20 }'
}

# What names this run: its pid, and the moment that pid started. It goes on the
# compositor's marker and it is what collects that compositor again, so a run
# is told apart from every other run on the machine — living or dead — by one
# string that nothing else can hold.
compositor_owner() {
  printf '%s:%s\n' "$$" "$(process_start_time "$$")"
}

# The environment a compositor is started through, as words for a command line.
# `DOMICILE_COMPOSITOR` is what everything below recognizes it by; the caller
# adds whatever else the compositor needs.
compositor_env() {
  printf '%s\n' "DOMICILE_COMPOSITOR=$(compositor_owner)"
}

# Whether the run a marker names is still there to want its compositor: the pid
# is held, and by the same process that started the compositor rather than by
# whatever took the number next.
owner_is_running() {
  [ "$(process_start_time "${1%%:*}")" = "${1#*:}" ]
}

# With a pid: the compositor that pid started. Without one: every compositor
# whose starter is gone, and none that a live one is still using.
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

# Stop them, and say so: a line in the step log is the difference between this
# working and looking like it works, which is how the leak above survived.
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
  # Five seconds, a fifth at a time.
  for attempt in $(seq 1 25); do
    left="$(compositor_pids "$want")"
    [ -n "$left" ] || return 0
    sleep 0.2
  done
  echo "$(compositor_count "$left") would not take SIGTERM in five seconds, killing" >&2
  # shellcheck disable=SC2086 # as above
  kill -KILL $left 2>/dev/null
}
