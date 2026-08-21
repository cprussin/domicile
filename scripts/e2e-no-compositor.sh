#!/usr/bin/env bash
# Reproducible check that a shell which cannot reach the compositor says so,
# once, and stops.
#   nix develop .#full -c ./scripts/e2e-no-compositor.sh
#
# Starting the shell without the compositor running is the commonest way this
# fails, and everything about it lives in the renderer now: the preload holds
# the socket, and the only route from there to a terminal is an IPC channel to
# the main process. That path has been silently wrong twice — once printing
# nothing at all and running on as a deaf desktop, once printing a true
# diagnosis followed by a false one — and neither showed up in any suite,
# because no suite starts the shell expecting it to fail.
#
# Exactly one line is the assertion, not merely a non-empty one. Node emits
# `close` after every `error`, so a handler that does not tell them apart
# reports twice and the second reason is invented.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NO_COLOR=1

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# Electron is not on `PATH` under `nix develop`, and a missing one exits 127 —
# which without this reads as a shell that printed nothing, the very failure
# this check exists to detect.
if ! command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null | tail -1 || true)"
  [ -n "$ELECTRON_BIN" ] || { echo "SKIP: no electron to run the shell with"; exit 77; }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

export XDG_RUNTIME_DIR="/tmp/domicile-rt-nocomp"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
# Named after this check and removed rather than merely absent: a socket left
# by some other run would make this pass by connecting to it.
SOCK="$XDG_RUNTIME_DIR/never-listening.sock"
rm -f "$SOCK"
LOG="$(mktemp)"; DISPLAY_FILE="$(mktemp)"
# TERM, not KILL. A `kill -9`d X server cannot unlink its socket or its lock,
# and the corpse it leaves is indistinguishable from a live display to anything
# that tests for the socket — which is how this check spent its first day
# passing once and then failing two runs in three, with Electron segfaulting
# against a dead display and reporting zero lines. Zero lines is also what the
# bug this exists to catch looks like.
trap 'kill ${XVFB:-} 2>/dev/null; rm -f "$LOG" "$DISPLAY_FILE"' EXIT

# Headless X for Electron, on a display the *server* chooses. Picking a number
# ourselves is the other half of the same problem: whatever number we pick, a
# previous run may have left something at it, and there is no reliable way from
# a shell to tell a live X server from the socket of a dead one. `-displayfd`
# hands the question to the thing that actually knows.
Xvfb -displayfd 3 -screen 0 800x600x24 3>"$DISPLAY_FILE" >/dev/null 2>&1 &
XVFB=$!
for _ in $(seq 1 100); do [ -s "$DISPLAY_FILE" ] && break; sleep 0.1; done
[ -s "$DISPLAY_FILE" ] || { echo "Xvfb never came up"; exit 1; }
export DISPLAY=":$(tr -d '[:space:]' <"$DISPLAY_FILE")"

# A timeout well past the point where a shell that was going to exit has: the
# failure this guards against is one that never exits at all, and `timeout`
# reports 124 for it, which is not the 1 the check wants either way.
DOMICILE_CHROME_SOCKET="$SOCK" timeout 30 \
  electron --no-sandbox --disable-gpu --disable-dev-shm-usage "$ROOT/apps/shell" \
  >"$LOG" 2>&1
STATUS=$?

# Exactly 1, not merely non-zero. Every other way this can end is the harness
# rather than the shell, and each of them ends with no `domicile:` line — which
# is also what the bug this exists to catch looks like, so "non-zero and quiet"
# would let a broken harness report a pass for the wrong reason:
#
#   124  `timeout` fired: it came up deaf and stayed up. The original bug.
#   127  no electron.
#   139  a segfault, which is what Electron does with no usable display.
#     0  it came up and was content to have no compositor.
case "$STATUS" in
  1) echo "OK: the shell exited 1 rather than running on" ;;
  124) echo "FAIL: the shell never exited. It came up without a compositor and stayed up."; exit 1 ;;
  0) echo "FAIL: the shell exited 0 with no compositor to talk to."; exit 1 ;;
  *)
    echo "FAIL: the shell ended with $STATUS, which is neither of its own exits."
    echo "  That is the harness rather than the shell. Its last words:"
    tail -5 "$LOG" | sed 's/^/    /'
    exit 1
    ;;
esac

# The whole message, not merely a count of lines beginning `domicile:`. A
# shell that never opened the socket at all — a mangled `additionalArguments`,
# say, so `socketPathFrom` throws before `net.connect` is reached — dies with
# one accurate `domicile:` line of its own, and a count alone reads that as
# this check passing. What is being asserted is that it failed *for this
# reason*, and the reason names a path the script already holds.
EXPECTED="^domicile: the compositor socket at $SOCK failed: "
SAID="$(grep -c "$EXPECTED" "$LOG")"
if [ "$SAID" != "1" ]; then
  echo "FAIL: expected exactly one line about the socket, got $SAID."
  echo "  everything the shell said:"
  grep '^domicile: ' "$LOG" | sed 's/^/    /'
  exit 1
fi
grep "$EXPECTED" "$LOG" | sed 's/^/  /'
echo "PASS: a shell with no compositor said so once and stopped"
