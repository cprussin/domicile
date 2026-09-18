#!/usr/bin/env bash
# A desktop that does not come up says what failed, on the terminal it was
# started from -- and is started again, until it is clear that it will not
# come up.
#
#   ./scripts/test-a-desktop-that-fails-says-why.sh
#
# The unit tests own the sentences and the restart policy; this owns the
# wiring, which is the half they cannot reach. `domicile` starts two processes
# and watches them, and what is being checked is that a component which stops
# running is noticed, named, reported and REPLACED *by the real binary* -- not
# that a function returns the right string when a closure says a process is
# gone, and not that a loop calls a closure that says it started something.
#
# THE GIVE-UP IS CHECKED BY THE BINARY EXITING ON ITS OWN. Each run below is
# under a `timeout` that is far longer than the four backoffs the default
# policy spends (1s, 2s, 4s, 8s), so a run killed by that timeout is a run that
# was still flapping -- which is the failure a restart loop has, and it reads
# identically to a pass if only the log is grepped. The exit status is checked
# for exactly that reason: 124 is the timeout, and anything else is the binary
# deciding to stop.
#
# THE POSITIVE READING COMES FIRST, and that is the whole shape of this script.
# Two guards in this repo learned it the hard way: a check that measures only
# an absence proves nothing, because "the failure was reported" and "the
# harness never got that far" look identical from the outside. So the first run
# is a desktop that comes up — and only once that has been seen do the two runs
# that break it mean anything.
#
# The two components are shell scripts here. Nothing about the supervisor cares
# what they are: it starts them, waits for a file each one is supposed to
# create, and watches whether they are still running. A real engine takes four
# hours to build and needs a display; these take a millisecond and need
# neither, and they are wrong in exactly the ways a real one is.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }
command -v timeout >/dev/null 2>&1 || { echo "SKIP: no timeout(1)"; exit 77; }

echo "== building domicile =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bin domicile ) || {
  echo "FAIL: domicile would not build"; exit 1; }
DOMICILE="$TARGET/debug/domicile"
[ -x "$DOMICILE" ] || { echo "FAIL: no binary at $DOMICILE"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A shell to run, so `shell_path` has a module to name. Nothing loads it: the
# engine here is a shell script.
mkdir -p "$WORK/dist"
: >"$WORK/dist/shell.js"

# The engine, as the supervisor knows it: a directory with `chrome` in it,
# which creates the broker socket it was told to create and then stays alive.
mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<'ENGINE'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --domicile-broker-socket=*) broker="${arg#*=}" ;;
  esac
done
# One character per start, so a restart is counted rather than inferred from a
# sentence the supervisor printed about its own intentions.
[ -n "${DOMICILE_FAKE_STARTS:-}" ] && printf 'x' >>"$DOMICILE_FAKE_STARTS"
[ -n "${DOMICILE_FAKE_ENGINE_DIES:-}" ] && exit 3
: >"$broker"
exec sleep 30
ENGINE
chmod +x "$WORK/engine/chrome"

# The compositor: publishes the session document it was told to publish, then
# stays alive.
cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
[ -n "${DOMICILE_FAKE_COMPOSITOR_DIES:-}" ] && exit 4
: >"$session"
# A desktop that came up and then lost a component, which is the failure the
# restart is for. The second of grace is what makes it that rather than a race
# with the milestone: the supervisor polls for the session document every
# 100ms, and a compositor that exited in the same instant it published one
# would be reported as a milestone that was never reached.
if [ -n "${DOMICILE_FAKE_COMPOSITOR_DIES_AFTER_UP:-}" ]; then
  sleep 1
  exit 6
fi
exec sleep 30
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

# `headless` because there is no display here and `platform` refuses to guess
# one. `XDG_RUNTIME_DIR` because that is where the run's own directory goes,
# and a stale one from another run must not be inherited.
#
# The timeout is the caller's because it means two different things: on the
# desktop that comes up it is how the run is ended, and on a desktop that fails
# it is a harness of last resort that a pass must not need. `STATUS` is how the
# second kind is told apart -- see the note at the top.
run_domicile() {
  local patience="$1"; shift
  local log="$1"; shift
  env OZONE=headless \
      XDG_RUNTIME_DIR="$WORK/runtime" \
      DOMICILE_ENGINE="$WORK/engine" \
      DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
      "$@" \
      timeout "$patience" "$DOMICILE" "$WORK/dist/shell.js" >"$log" 2>&1
  STATUS=$?
}

mkdir -p "$WORK/runtime"
FAILED=0

# ---- the positive reading -------------------------------------------------

echo "== a desktop that comes up says so =="
UP="$WORK/up.log"
run_domicile 10 "$UP" DOMICILE_NOTHING=
if grep -q "domicile is up" "$UP"; then
  echo "PASS: both components started and the run got past every milestone"
else
  echo "FAIL: the harness never reached a running desktop, so nothing below"
  echo "      would mean anything. What it said:"
  sed 's/^/    /' "$UP"
  exit 1
fi

# ---- an engine that stops running -----------------------------------------

echo "== an engine that exits is named, with its status, and is started again =="
GONE="$WORK/engine-gone.log"
STARTS="$WORK/engine-starts"
: >"$STARTS"
run_domicile 60 "$GONE" DOMICILE_FAKE_ENGINE_DIES=1 DOMICILE_FAKE_STARTS="$STARTS"
STARTED="$(wc -c <"$STARTS" | tr -d ' ')"
if grep -q "the engine exited (exit status: 3)" "$GONE" &&
   grep -q "broker socket at .*never turned up" "$GONE"; then
  echo "PASS: $(grep -m1 'the engine exited' "$GONE")"
else
  echo "FAIL: an engine that exited 3 was not reported. What it said:"
  sed 's/^/    /' "$GONE"
  FAILED=1
fi

# The count is the assertion and the sentence is not: a supervisor that printed
# "starting the desktop again" and started nothing would pass a grep.
if [ "$STARTED" = 5 ] && grep -q "starting the desktop again in 1s" "$GONE"; then
  echo "PASS: the engine was started $STARTED times, backing off between them"
else
  echo "FAIL: the engine was started $STARTED times, not 5. What it said:"
  sed 's/^/    /' "$GONE"
  FAILED=1
fi

if grep -q "5 desktops in a row have failed" "$GONE" && [ "$STATUS" = 1 ]; then
  echo "PASS: it gave up on its own, rather than flapping until the timeout"
else
  echo "FAIL: it exited $STATUS (124 is the timeout, which means it was still"
  echo "      going). What it said:"
  sed 's/^/    /' "$GONE"
  FAILED=1
fi

# ---- a compositor that stops running --------------------------------------

echo "== a compositor that exits is named, with its status =="
DEAD="$WORK/compositor-gone.log"
run_domicile 60 "$DEAD" DOMICILE_FAKE_COMPOSITOR_DIES=1
if grep -q "the compositor exited (exit status: 4)" "$DEAD" &&
   grep -q "session document at .*never turned up" "$DEAD" &&
   grep -q "5 desktops in a row have failed" "$DEAD" &&
   [ "$STATUS" = 1 ]; then
  echo "PASS: $(grep -m1 'the compositor exited' "$DEAD")"
else
  echo "FAIL: a compositor that exited 4 was not reported, or the run did not"
  echo "      give up on its own (it exited $STATUS). What it said:"
  sed 's/^/    /' "$DEAD"
  FAILED=1
fi

# ---- a desktop that was up and then lost a component ----------------------
#
# THIS IS THE ONE THE RESTART EXISTS FOR, and it is not the same case as the
# two above: those never came up, so nothing had been handed out yet. Here the
# desktop reached "domicile is up" first, which is where a user was.

echo "== a desktop that comes up and dies is stood back up =="
AGAIN="$WORK/up-then-dead.log"
run_domicile 60 "$AGAIN" DOMICILE_FAKE_COMPOSITOR_DIES_AFTER_UP=1
UPS="$(grep -c "domicile is up" "$AGAIN")"
if [ "$UPS" -ge 2 ] &&
   grep -q "the compositor exited (exit status: 6)" "$AGAIN" &&
   [ "$STATUS" = 1 ]; then
  echo "PASS: the desktop came up $UPS times, each after the last one died"
else
  echo "FAIL: a desktop that died after coming up was not stood back up; it"
  echo "      came up $UPS times and exited $STATUS. What it said:"
  sed 's/^/    /' "$AGAIN"
  FAILED=1
fi

exit "$FAILED"
