#!/usr/bin/env bash
# Tests that neither shortcuts-inhibitor guard returns while anything it
# started is still running.
#
# Each guard starts two background processes whose `$!` is not the process
# that lives: `wtype` behind a `nix shell` wrapper, holding the seat for five
# minutes, and a browser with a zygote, GPU process and renderers. Signaling
# only those pids leaves the rest running into later checks, including the
# timing one.
#
# Both are started here through the guard's own lines, taken from the real
# script, with stand-ins of the same shape. The guard's cleanup runs on EXIT,
# and the check runs as soon as it returns, without waiting.
#
# One file covers `guard-shortcuts-inhibitor.sh` and
# `guard-shortcuts-inhibitor-chord.sh`: they start the same two processes the
# same way.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

# Liveness is read from /proc. Exit 77 means the check did not run.
if [ ! -r /proc/self/stat ]; then
  echo "SKIP: no procfs, so nothing here can tell a process that is gone"
  exit 77
fi

# Runs one guard. Each runs in its own subshell, so stand-ins, trap and exit
# stay separate.
leaves_nothing() { # guard script name, the first line of what its cleanup reads, binds, crashes
  GUARD="$SCRIPTS/$1"
  [ -f "$GUARD" ] || { echo "  FAIL  no guard at $GUARD" >&2; exit 1; }

  LIBRARIES="$(piece "sourced libraries" '/^\. "\$SCRIPTS\/lib-[a-z-]+\.sh"$/')" ||
    exit 1
  # From what the guard's cleanup reads to the trap that runs it.
  CLEANUP="$(piece "cleanup" "/^$2\$/,/^trap cleanup EXIT\$/")" ||
    exit 1
  KEYBOARD="$(piece "virtual keyboard" '/^: >"\$KEYBOARD_LOG"$/,/^fi$/')" ||
    exit 1
  ENGINE="$(piece "engine start" '/^if \[ "\$NEGATIVE" = "1" \]; then$/,/>"\$ENGINE_LOG" 2>&1 &$/')" ||
    exit 1

  WORK="$(mktemp -d)"
  export XDG_RUNTIME_DIR="$WORK/runtime"
  mkdir -p "$XDG_RUNTIME_DIR"
# Each stand-in records its own pid and its child's.
  export PIDS="$WORK/pids"
  : >"$PIDS"
# What the host was asked, for a guard that installs a binding.
  export SWAYMSG_SAID="$WORK/swaymsg"
  trap 'for p in $(cat "$PIDS"); do kill -KILL "$p" 2>/dev/null; done
        rm -rf "$WORK"' EXIT

  # `wtype` behind a wrapper: `$!` is the wrapper and a forked child holds the
  # seat. `-s` is milliseconds, as in wtype, so the guard's probe (`-s 1`) ends
  # at once and its hold (`-s $KEYBOARD_LIVES_FOR_MS`) does not. After `sh -c`,
  # wtype's `-k Shift_L -s N` are `$0 $1 $2 $3`.
  WTYPE=(sh -c 'sleep "$(($3 / 1000))" & echo "$$ $!" >>"$PIDS"; wait')

  # A browser with children, where the guard looks for one.
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
  # Or a browser that crashed and orphaned its children, as seen on crux.
  # Walking the browser's process tree no longer finds them.
  if [ "${4:-}" = "crashes" ]; then
    sed -i 's/^wait$/ulimit -c 0; kill -SEGV $$/' "$CHROMIUM/$OUT/chrome"
  fi
  chmod +x "$CHROMIUM/$OUT/chrome"

  # The guard from its libraries to its exit, in its own subshell, so its trap
  # fires on the way out as it does in the real guard.
  (
    NEGATIVE=0 KEYBOARD_LIVES_FOR_MS=300000
    KEYBOARD_LOG="$WORK/keyboard.log" ENGINE_LOG="$WORK/engine.log"
    PROFILE="$WORK/profile" BROKER="$WORK/broker" WIDTH=1 HEIGHT=1
    eval "$LIBRARIES"
    eval "$CLEANUP"
    # A host binding, as the chord guard holds once swaymsg accepted it.
    # Cleanup must remove it. The request guard installs none.
    BOUND=1 CHORD=Mod4+stand-in
    SWAYMSG=(sh -c 'echo "$*" >>"$SWAYMSG_SAID"' swaymsg)
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
    # A piece that stopped early started less than the guard does, and the
    # cleanup would have nothing to do.
    echo "  FAIL  $1's pieces ran to the end (status $?)" >&2
    exit 1
  }

  LEFT=""
  for pid in $(cat "$PIDS"); do
    running "$pid" && LEFT="$LEFT $pid"
  done

  UNBOUND=1
  if [ "$3" = "binds" ]; then
    grep -q -- '-- unbindsym Mod4+' "$SWAYMSG_SAID" 2>/dev/null || UNBOUND=0
  fi

  if [ -z "$LEFT" ] && [ "$UNBOUND" = "1" ]; then
    echo "  ok    nothing $1 started outlives it${4:+, when its engine $4}"
    exit 0
  fi
  echo "  FAIL  nothing $1 started outlives it${4:+, when its engine $4}"
  for pid in $LEFT; do
    printf '    still running: %s\n' "$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
  done
  [ "$UNBOUND" = "1" ] ||
    echo "    still bound in the host: cleanup never asked swaymsg to unbindsym"
  exit 1
}

# A piece of `$GUARD` between two whole lines at column zero. A rewrite that
# moves either fails here.
piece() { # what, awk range
  local text
  text="$(awk "$2" "$GUARD")"
  [ -n "$text" ] || {
    echo "  FAIL  no $1 in $GUARD — its markers moved. Fix this test with it." >&2
    return 1
  }
  printf '%s\n' "$text"
}

# Three stand-ins record themselves: the keyboard's probe, its hold, and the
# engine. Wait for all three before cleanup runs.
PATIENCE=30
recorded() { [ "$(grep -c . "$PIDS")" = 3 ]; }

# Running, not a zombie awaiting reaping: field 3 of stat.
running() { # pid
  local stat
  stat="$( { cat "/proc/$1/stat"; } 2>/dev/null )"
  [ -n "$stat" ] && [ "$(printf '%s\n' "${stat##*) }" | awk '{ print $1 }')" != Z ]
}

FAILED=0
( leaves_nothing guard-shortcuts-inhibitor.sh 'CAPTURE="\$\(mktemp\)"' "" ) ||
  FAILED=$((FAILED + 1))
( leaves_nothing guard-shortcuts-inhibitor-chord.sh 'BOUND=0' binds ) ||
  FAILED=$((FAILED + 1))
( leaves_nothing guard-shortcuts-inhibitor-chord.sh 'BOUND=0' binds crashes ) ||
  FAILED=$((FAILED + 1))
[ "$FAILED" -eq 0 ]
