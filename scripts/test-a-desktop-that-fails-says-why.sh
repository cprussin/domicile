#!/usr/bin/env bash
# Checks the supervisor reports a failed component on the terminal, restarts
# it, and gives up after repeated failures.
#
#   ./scripts/test-a-desktop-that-fails-says-why.sh
#
# Unit tests cover the messages and restart policy. This runs the real
# `domicile` binary against stub engine and compositor scripts, and counts
# their starts instead of trusting log lines.
#
# Each run has a `timeout` well past the default backoffs (1s, 2s, 4s, 8s).
# Exit 124 means the supervisor was still restarting; any other status means
# it stopped on its own.
#
# The first run must reach a working desktop, so the failure cases below are
# known to exercise the supervisor and not a broken harness.
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

# An empty module for `shell_path` to name; the stub engine never loads it.
mkdir -p "$WORK/dist"
: >"$WORK/dist/shell.js"

# Stub engine: creates the broker socket, then stays alive.
mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<'ENGINE'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --domicile-broker-socket=*) broker="${arg#*=}" ;;
  esac
done
# One byte per start, so restarts are counted.
[ -n "${DOMICILE_FAKE_STARTS:-}" ] && printf 'x' >>"$DOMICILE_FAKE_STARTS"
[ -n "${DOMICILE_FAKE_ENGINE_DIES:-}" ] && exit 3
: >"$broker"
# Dies one second after coming up, for the first N starts, then stays up. The
# delay avoids a race with the supervisor's milestone poll. Recovering lets
# the test show the desktop survives on a later engine.
if [ -n "${DOMICILE_FAKE_ENGINE_DIES_AFTER_UP:-}" ]; then
  so_far="$(wc -c <"$DOMICILE_FAKE_STARTS" | tr -d ' ')"
  if [ "$so_far" -le "$DOMICILE_FAKE_ENGINE_DIES_AFTER_UP" ]; then
    sleep 1
    exit 5
  fi
fi
exec sleep 30
ENGINE
chmod +x "$WORK/engine/chrome"

# Stub compositor: publishes the session document, then stays alive. Counts
# its starts to tell an engine-only restart from a full desktop restart.
cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
[ -n "${DOMICILE_FAKE_COMPOSITOR_STARTS:-}" ] && printf 'x' >>"$DOMICILE_FAKE_COMPOSITOR_STARTS"
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
[ -n "${DOMICILE_FAKE_COMPOSITOR_DIES:-}" ] && exit 4
# Fails with a config error shaped like the real one: a line naming the file,
# the reason, and a trailing blank line.
if [ -n "${DOMICILE_FAKE_COMPOSITOR_COMPLAINS:-}" ]; then
  {
    echo "fake-compositor: the config at /nowhere/domicile.json could not be loaded:"
    echo "invalid config syntax: unknown field \`compositor\`, expected \`input\` or \`output\` at line 1 column 15"
    echo
  } >&2
  exit 1
fi
: >"$session"
# Dies one second after coming up. The supervisor polls the session document
# every 100ms, so exiting immediately would look like it never came up.
if [ -n "${DOMICILE_FAKE_COMPOSITOR_DIES_AFTER_UP:-}" ]; then
  sleep 1
  exit 6
fi
exec sleep 30
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

# `OZONE=headless` because there is no display. A private `XDG_RUNTIME_DIR`
# avoids inheriting another run's directory.
#
# The caller sets the timeout: it ends a run that should stay up, and is a
# last resort for a run that should give up. `STATUS` holds the exit status.
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

# Assert on the start count, not only the message.
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

# ---- an engine that dies under a compositor that is still serving ----------
#
# The engine dies after the desktop is up. Only the engine should restart:
# the compositor, and its clients, must stay. The compositor start count
# shows that.

echo "== an engine that dies after the desktop is up takes only itself =="
ALONE="$WORK/engine-alone.log"
ENGINES="$WORK/engine-restarts"
COMPOSITORS="$WORK/compositor-restarts"
: >"$ENGINES"
: >"$COMPOSITORS"
# 12s covers two backoffs (1s, 2s) plus the third engine staying up. The run
# should still be up when the timeout ends it, so 124 is a pass.
run_domicile 12 "$ALONE" \
  DOMICILE_FAKE_ENGINE_DIES_AFTER_UP=2 \
  DOMICILE_FAKE_STARTS="$ENGINES" \
  DOMICILE_FAKE_COMPOSITOR_STARTS="$COMPOSITORS"
ENGINE_STARTS="$(wc -c <"$ENGINES" | tr -d ' ')"
COMPOSITOR_STARTS="$(wc -c <"$COMPOSITORS" | tr -d ' ')"
CAME_UP="$(grep -c "domicile is up" "$ALONE")"

if [ "$ENGINE_STARTS" = 3 ] && [ "$COMPOSITOR_STARTS" = 1 ] && [ "$CAME_UP" = 1 ]; then
  echo "PASS: $ENGINE_STARTS engines under the one compositor that came up once"
else
  echo "FAIL: $ENGINE_STARTS engines, $COMPOSITOR_STARTS compositors and"
  echo "      $CAME_UP desktops — the compositor went with the engine. What it said:"
  sed 's/^/    /' "$ALONE"
  FAILED=1
fi

if grep -q "the engine exited (exit status: 5)" "$ALONE" &&
   grep -q "starting the engine again in 1s" "$ALONE" &&
   grep -q "starting the engine again in 2s" "$ALONE" &&
   ! grep -q "starting the desktop again" "$ALONE"; then
  echo "PASS: $(grep -m1 'starting the engine again' "$ALONE")"
else
  echo "FAIL: the run did not say it was starting the engine again, or said it"
  echo "      was starting the desktop again. What it said:"
  sed 's/^/    /' "$ALONE"
  FAILED=1
fi

# Here 124 is the expected status: the desktop should still be up.
if [ "$STATUS" = 124 ]; then
  echo "PASS: the desktop was still up on its third engine when the run was ended"
else
  echo "FAIL: it exited $STATUS, so the desktop did not survive its engines."
  echo "      What it said:"
  sed 's/^/    /' "$ALONE"
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

# ---- a compositor that would not start says why at the bottom too ---------
#
# The reason must be repeated after the give-up line, since the end of the
# output is where a person looks.

echo "== a compositor that would not start says why again at the end =="
SAID="$WORK/complained.log"
run_domicile 60 "$SAID" DOMICILE_FAKE_COMPOSITOR_COMPLAINS=1
GAVE_UP_AT="$(grep -n "desktops in a row have failed" "$SAID" | tail -1 | cut -d: -f1)"
LAST_LINE_AT="$(grep -n "unknown field" "$SAID" | tail -1 | cut -d: -f1)"
LAST_FILE_AT="$(grep -n "could not be loaded" "$SAID" | tail -1 | cut -d: -f1)"
TIMES="$(grep -c "unknown field" "$SAID")"

# Five live copies plus one repeat. The live output must still appear.
if [ "$TIMES" = 6 ]; then
  echo "PASS: what it said went past five times and was said once more at the end"
else
  echo "FAIL: the complaint appears $TIMES times, not 6. What it said:"
  sed 's/^/    /' "$SAID"
  FAILED=1
fi

# The repeat must come after the give-up line.
if [ -n "$GAVE_UP_AT" ] && [ -n "$LAST_LINE_AT" ] && [ "$LAST_LINE_AT" -gt "$GAVE_UP_AT" ]; then
  echo "PASS: the reason is below the line that gave up, not above it"
else
  echo "FAIL: it gave up at line $GAVE_UP_AT and last said why at line"
  echo "      $LAST_LINE_AT. What it said:"
  sed 's/^/    /' "$SAID"
  FAILED=1
fi

# The repeat must include the line naming the file.
if [ -n "$LAST_FILE_AT" ] && [ "$LAST_FILE_AT" -gt "$GAVE_UP_AT" ]; then
  echo "PASS: the file it was about came back with it"
else
  echo "FAIL: the repeat did not carry the whole complaint. What it said:"
  sed 's/^/    /' "$SAID"
  FAILED=1
fi

# ---- a desktop that was up and then lost a component ----------------------
#
# Unlike the cases above, this desktop reached "domicile is up" first.

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
