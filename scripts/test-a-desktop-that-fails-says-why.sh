#!/usr/bin/env bash
# A desktop that does not come up says what failed, on the terminal it was
# started from.
#
#   ./scripts/test-a-desktop-that-fails-says-why.sh
#
# The unit tests own the sentences; this owns the wiring, which is the half
# they cannot reach. `domicile` starts two processes and watches them, and what
# is being checked is that a component which stops running is noticed, named,
# and reported *by the real binary* — not that a function returns the right
# string when a closure says a process is gone.
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
exec sleep 30
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

# `headless` because there is no display here and `platform` refuses to guess
# one. `XDG_RUNTIME_DIR` because that is where the run's own directory goes,
# and a stale one from another run must not be inherited.
run_domicile() {
  local log="$1"; shift
  env OZONE=headless \
      XDG_RUNTIME_DIR="$WORK/runtime" \
      DOMICILE_ENGINE="$WORK/engine" \
      DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
      "$@" \
      timeout 10 "$DOMICILE" "$WORK/dist/shell.js" >"$log" 2>&1
}

mkdir -p "$WORK/runtime"
FAILED=0

# ---- the positive reading -------------------------------------------------

echo "== a desktop that comes up says so =="
UP="$WORK/up.log"
run_domicile "$UP" DOMICILE_NOTHING=
if grep -q "domicile is up" "$UP"; then
  echo "PASS: both components started and the run got past every milestone"
else
  echo "FAIL: the harness never reached a running desktop, so nothing below"
  echo "      would mean anything. What it said:"
  sed 's/^/    /' "$UP"
  exit 1
fi

# ---- an engine that stops running -----------------------------------------

echo "== an engine that exits is named, with its status =="
GONE="$WORK/engine-gone.log"
run_domicile "$GONE" DOMICILE_FAKE_ENGINE_DIES=1
if grep -q "the engine exited (exit status: 3)" "$GONE" &&
   grep -q "broker socket at .*never turned up" "$GONE"; then
  echo "PASS: $(grep -m1 'the engine exited' "$GONE")"
else
  echo "FAIL: an engine that exited 3 was not reported. What it said:"
  sed 's/^/    /' "$GONE"
  FAILED=1
fi

# ---- a compositor that stops running --------------------------------------

echo "== a compositor that exits is named, with its status =="
DEAD="$WORK/compositor-gone.log"
run_domicile "$DEAD" DOMICILE_FAKE_COMPOSITOR_DIES=1
if grep -q "the compositor exited (exit status: 4)" "$DEAD" &&
   grep -q "session document at .*never turned up" "$DEAD"; then
  echo "PASS: $(grep -m1 'the compositor exited' "$DEAD")"
else
  echo "FAIL: a compositor that exited 4 was not reported. What it said:"
  sed 's/^/    /' "$DEAD"
  FAILED=1
fi

exit "$FAILED"
