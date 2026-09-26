#!/usr/bin/env bash
# That the shortcuts-inhibitor guard does not return while anything it started
# is still running.
#
# The guard starts two things in the background, and on `crux` the pid a `&`
# hands back is the right one for neither: the virtual keyboard is `wtype`
# behind a `nix shell` wrapper, holding the seat for five minutes, and the
# engine is a browser with a zygote, a GPU process and renderers under it. A
# cleanup that signals those two pids and returns leaves whatever is behind
# them running — into the checks after it, which include the one that times
# things.
#
# So both are started here through the guard's own lines, out of the real
# script, with stand-ins of the same shape: a wrapper whose `$!` is not the
# process that lives. The guard's cleanup runs the way it does there, on EXIT,
# and what is asserted is asked the moment that returns — not waited for,
# because a guard that returns first is the leak.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-shortcuts-inhibitor.sh"
[ -f "$GUARD" ] || { echo "no guard at $GUARD" >&2; exit 1; }

# What is alive is read out of /proc, so a machine without one cannot say.
# 77 is how a check says it did not run.
if [ ! -r /proc/self/stat ]; then
  echo "SKIP: no procfs, so nothing here can tell a process that is gone"
  exit 77
fi

# The guard's pieces, each between two lines that are whole at column zero.
# A rewrite that moves one fails here rather than leaving this passing against
# a version nobody ships.
piece() { # what, awk range
  local text
  text="$(awk "$2" "$GUARD")"
  [ -n "$text" ] || {
    echo "no $1 in $GUARD — its markers moved. Fix this test with it." >&2
    exit 1
  }
  printf '%s\n' "$text"
}
LIBRARIES="$(piece "sourced libraries" '/^\. "\$SCRIPTS\/lib-[a-z-]+\.sh"$/')"
CLEANUP="$(piece "cleanup" '/^CAPTURE="\$\(mktemp\)"$/,/^trap cleanup EXIT$/')"
KEYBOARD="$(piece "virtual keyboard" '/^: >"\$KEYBOARD_LOG"$/,/^fi$/')"
ENGINE="$(piece "engine start" '/^if \[ "\$NEGATIVE" = "1" \]; then$/,/^# 3\. /')"

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -p "$XDG_RUNTIME_DIR"
# Every stand-in writes its own pid and the one it forked here, once it has.
export PIDS="$WORK/pids"
: >"$PIDS"
trap 'for p in $(cat "$PIDS"); do kill -KILL "$p" 2>/dev/null; done
      rm -rf "$WORK"' EXIT

# `wtype` behind a wrapper: `$!` is the wrapper, and what holds the seat is a
# child it forked. `-s` is milliseconds, as wtype's is, so the guard's probe
# (`-s 1`) ends at once and its hold (`-s $KEYBOARD_LIVES_FOR_MS`) does not.
# After `sh -c`, wtype's `-k Shift_L -s N` are `$0 $1 $2 $3`.
WTYPE=(sh -c 'sleep "$(($3 / 1000))" & echo "$$ $!" >>"$PIDS"; wait')

# A browser with children, in the place the guard looks for one.
CHROMIUM="$WORK/chromium"
OUT=out/Domicile
mkdir -p "$CHROMIUM/$OUT"
cat >"$CHROMIUM/$OUT/chrome" <<'CHROME'
#!/bin/sh
sleep 300 &
first=$!
sleep 300 &
echo "$$ $first $!" >>"$PIDS"
wait
CHROME
chmod +x "$CHROMIUM/$OUT/chrome"

# Three stand-ins record themselves: the keyboard's probe, its hold, and the
# engine. Until all three have, a cleanup has less to leave behind than the
# guard's does.
PATIENCE=30
recorded() { [ "$(grep -c . "$PIDS")" = 3 ]; }

# The guard, from its libraries to its exit, in a subshell of its own: the trap
# it sets fires where the guard's fires, on the way out.
(
  NEGATIVE=0 KEYBOARD_LIVES_FOR_MS=300000
  KEYBOARD_LOG="$WORK/keyboard.log" ENGINE_LOG="$WORK/engine.log"
  PROFILE="$WORK/profile" BROKER="$WORK/broker" WIDTH=1 HEIGHT=1
  eval "$LIBRARIES"
  eval "$CLEANUP"
  eval "$KEYBOARD" >/dev/null
  eval "$ENGINE" >/dev/null
  deadline=$((SECONDS + PATIENCE))
  until recorded; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "  FAIL  the stand-ins never all started, in $PATIENCE seconds." >&2
      echo "    That is this script standing its scenery up, not the guard." >&2
      exit 1
    fi
    sleep 0.1
  done
) || {
  # A piece that stopped short started less than the guard does, and would
  # leave this passing over a cleanup that had nothing to do.
  echo "  FAIL  the guard's pieces ran to the end (status $?)" >&2
  exit 1
}

# Running, as opposed to a zombie nobody has reaped yet: field 3 of stat.
running() { # pid
  local stat
  stat="$( { cat "/proc/$1/stat"; } 2>/dev/null )"
  [ -n "$stat" ] && [ "$(printf '%s\n' "${stat##*) }" | awk '{ print $1 }')" != Z ]
}

LEFT=""
for pid in $(cat "$PIDS"); do
  running "$pid" && LEFT="$LEFT $pid"
done

if [ -z "$LEFT" ]; then
  echo "  ok    nothing the guard started outlives it"
  exit 0
fi
echo "  FAIL  nothing the guard started outlives it"
for pid in $LEFT; do
  printf '    still running: %s\n' "$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
done
exit 1
