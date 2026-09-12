#!/usr/bin/env bash
# A running desktop answers a control socket, and only one desktop has it.
#
#   ./scripts/test-the-control-socket.sh
#
# The unit tests own the socket's rules — where it is, what happens to a stale
# one, what a line that is not a request gets back. This owns the wiring, which
# is the half they cannot reach: that the *binary* takes the socket when it
# starts a desktop, answers on it from a thread while the supervisor is blocked
# waiting on its components, and that a second `domicile` on the same session
# is refused rather than started beside the first.
#
# THE POSITIVE READING COMES FIRST, the same way
# `test-a-desktop-that-fails-says-why.sh` does it: a command that reaches a
# desktop and comes back with the right answer, before any of the refusals mean
# anything. "The command was refused" and "the desktop never came up" look
# identical from the outside otherwise.
#
# The two components are shell scripts here. Nothing about the supervisor cares
# what they are, and a real engine takes four hours to build and needs a
# display.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }

echo "== building domicile =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bin domicile ) || {
  echo "FAIL: domicile would not build"; exit 1; }
DOMICILE="$TARGET/debug/domicile"
[ -x "$DOMICILE" ] || { echo "FAIL: no binary at $DOMICILE"; exit 1; }

WORK="$(mktemp -d)"
DESKTOP=""
cleanup() {
  if [ -n "$DESKTOP" ]; then
    kill "$DESKTOP" 2>/dev/null
    wait "$DESKTOP" 2>/dev/null
  fi
  # The fake components outlive a supervisor killed with a signal: nothing runs
  # its cleanup, which is true of the real ones too.
  pkill -f "$WORK/engine/chrome" 2>/dev/null
  pkill -f "$WORK/domicile-compositor" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# The shell this desktop is running. Nothing loads it — the engine here is a
# shell script — but it is the file `which-shell` has to name.
mkdir -p "$WORK/dist"
: >"$WORK/dist/shell.js"

# The engine: creates the broker socket it was told to create, then stays alive.
mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<'ENGINE'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --domicile-broker-socket=*) broker="${arg#*=}" ;;
  esac
done
: >"$broker"
exec sleep 60
ENGINE
chmod +x "$WORK/engine/chrome"

# The compositor: publishes the session document, then stays alive.
cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
: >"$session"
exec sleep 60
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

mkdir -p "$WORK/runtime"
# `headless` because there is no display here and `platform` refuses to guess.
run_domicile() {
  env OZONE=headless \
      XDG_RUNTIME_DIR="$WORK/runtime" \
      DOMICILE_ENGINE="$WORK/engine" \
      DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
      "$DOMICILE" "$@"
}

FAILED=0

# ---- a desktop that is up, and is asked -----------------------------------

echo "== a desktop comes up and takes the control socket =="
UP="$WORK/up.log"
run_domicile "$WORK/dist/shell.js" >"$UP" 2>&1 &
DESKTOP=$!

WAITED=0
while ! grep -q "domicile is up" "$UP" 2>/dev/null; do
  if [ "$WAITED" -ge 100 ]; then
    echo "FAIL: the desktop never came up, so nothing below would mean"
    echo "      anything. What it said:"
    sed 's/^/    /' "$UP"
    exit 1
  fi
  sleep 0.1
  WAITED=$((WAITED + 1))
done
echo "PASS: both components started and the run got past every milestone"

echo "== which-shell names the module the desktop is running =="
SAID="$(run_domicile which-shell 2>&1)"
if [ "$SAID" = "$WORK/dist/shell.js" ]; then
  echo "PASS: $SAID"
else
  echo "FAIL: which-shell said '$SAID', and the desktop is running"
  echo "      $WORK/dist/shell.js"
  FAILED=1
fi

# ---- the second desktop ---------------------------------------------------

echo "== a second desktop on the same session is refused =="
SECOND="$WORK/second.log"
if run_domicile "$WORK/dist/shell.js" >"$SECOND" 2>&1; then
  echo "FAIL: a second desktop started beside the first. What it said:"
  sed 's/^/    /' "$SECOND"
  FAILED=1
elif grep -q "a desktop is already running" "$SECOND"; then
  echo "PASS: $(grep -m1 'a desktop is already running' "$SECOND")"
else
  echo "FAIL: the second desktop failed for some other reason:"
  sed 's/^/    /' "$SECOND"
  FAILED=1
fi

# ---- nowhere to ask -------------------------------------------------------

echo "== asking where no desktop is running says so =="
EMPTY="$WORK/empty.log"
mkdir -p "$WORK/nobody"
if env XDG_RUNTIME_DIR="$WORK/nobody" "$DOMICILE" which-shell >"$EMPTY" 2>&1; then
  echo "FAIL: a command answered with no desktop to answer it:"
  sed 's/^/    /' "$EMPTY"
  FAILED=1
elif grep -q "no desktop is running here" "$EMPTY"; then
  echo "PASS: $(grep -m1 'no desktop is running here' "$EMPTY")"
else
  echo "FAIL: it failed for some other reason:"
  sed 's/^/    /' "$EMPTY"
  FAILED=1
fi

exit "$FAILED"
