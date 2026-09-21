#!/usr/bin/env bash
# Stopping a nested compositor means stopping all of it.
#
#   . "$SCRIPTS/lib-compositor-cleanup.sh"
#   export DOMICILE_UNDER_WAYLAND="$$"   # before anything is started
#   compositor_env                       # what to exec the compositor through
#   kill_compositors "$$"                # this run's, at exit
#   kill_compositors                     # at startup: whatever is left over
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
# EVERY WAY THIS CAN BE WRONG IS A COMPOSITOR SOMEBODY IS USING, so each of
# them has a rule and `scripts/test-under-wayland-cleanup.sh` has a case:
#
#   - the marker names the pid that started the compositor, so a run only ever
#     collects its own by name;
#   - the leftover sweep spares anything whose starter is still running, which
#     it decides by that starter's own marker rather than by its pid — a pid
#     alone answers yes for whatever process inherited that number next;
#   - it is scoped to one XDG_RUNTIME_DIR, so a run pointed somewhere else is
#     none of its business;
#   - and SIGTERM first, because sway takes swaybg with it and the bus goes on
#     its own. The second pass exists only so that one that will not go cannot
#     turn cleanup into a hang.

# How many processes a newline-separated list of pids is.
compositor_count() {
  printf '%s\n' "$1" | grep -c .
}

# The environment a compositor is started through, as words for a command line.
# `DOMICILE_COMPOSITOR` is what everything below recognizes it by; the caller
# adds whatever else the compositor needs.
compositor_env() {
  printf '%s\n' "DOMICILE_COMPOSITOR=$$"
}

# Whether the run a marker names is still there to want its compositor.
#
# The brace group so that the shell's own "no such process" for a pid that
# went away mid-scan is suppressed too: a `2>` on `tr` does not cover a
# redirection the shell could not open in the first place.
owner_is_running() {
  { tr '\0' '\n' < "/proc/$1/environ"; } 2>/dev/null |
    grep -Fqx "DOMICILE_UNDER_WAYLAND=$1"
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
