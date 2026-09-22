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
# An engine that came up, was joined, and then died -- which is the failure the
# compositor is meant to outlive. The second of grace is what makes it that
# rather than a race with the milestone, exactly as the compositor's own is.
#
# It dies for the first N starts and lives after that, so the run RECOVERS
# rather than flapping to a give-up: a desktop still serving on its third
# engine is the claim, and a give-up would prove only that the supervisor
# stopped.
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

# The compositor: publishes the session document it was told to publish, then
# stays alive. It counts its own starts for the same reason the engine does --
# an engine replaced under a live compositor and a whole desktop stood up again
# print different sentences, and only a count can tell the sentence from the
# thing it claims.
cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
[ -n "${DOMICILE_FAKE_COMPOSITOR_STARTS:-}" ] && printf 'x' >>"$DOMICILE_FAKE_COMPOSITOR_STARTS"
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
[ -n "${DOMICILE_FAKE_COMPOSITOR_DIES:-}" ] && exit 4
# A compositor that will not start, and says why on stderr -- the shape the
# real one's config complaint has, underlined span and trailing blank line
# included, because both are what the repeat has to survive.
if [ -n "${DOMICILE_FAKE_COMPOSITOR_COMPLAINS:-}" ]; then
  {
    echo "fake-compositor: the config at /nowhere/domicile.toml could not be loaded:"
    echo "invalid config syntax: TOML parse error at line 1, column 2"
    echo "  |"
    echo "1 | [compositor]"
    echo "  |  ^^^^^^^^^^"
    echo "unknown field \`compositor\`, expected \`input\` or \`output\`"
    echo
  } >&2
  exit 1
fi
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

# ---- an engine that dies under a compositor that is still serving ----------
#
# THE ONE CASE THE WHOLE CHANGE IS ABOUT. Above, the engine dies before it has
# created the broker socket, so the desktop never came up and there is nothing
# to keep. Here it creates the socket, the compositor is started and publishes
# its session document, and only then does the engine go -- which is a desktop
# with clients on it losing the process that draws, rather than losing itself.
#
# THE COMPOSITOR'S START COUNT IS THE ASSERTION. "starting the engine again"
# is a sentence the supervisor prints about its own intentions; one compositor
# for five engines is the claim that only one thing was replaced. A run that
# restarted the pair would print the same sentence and count five.

echo "== an engine that dies after the desktop is up takes only itself =="
ALONE="$WORK/engine-alone.log"
ENGINES="$WORK/engine-restarts"
COMPOSITORS="$WORK/compositor-restarts"
: >"$ENGINES"
: >"$COMPOSITORS"
# Twelve seconds is past the two backoffs two deaths earn (1s, 2s) and past the
# second the third engine needs to prove it stayed, and the timeout is what
# ends a run that is STILL UP -- which is the outcome here, so 124 is the pass.
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

# 124 here is the assertion rather than the harness of last resort it is
# everywhere else in this script: this run is meant to still be serving when
# the timeout ends it, and anything else is a desktop that stopped.
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
# THE ONE PLACE A PERSON LOOKS IS THE LAST LINE, and until this existed what
# was there was "Every one of them said why above" -- a pointer, from the end
# of the run, to six lines somewhere in two hundred of Chromium's. The live
# output still goes past as it happens; what is checked here is that the run
# does not *end* on a pointer.

echo "== a compositor that would not start says why again at the end =="
SAID="$WORK/complained.log"
run_domicile 60 "$SAID" DOMICILE_FAKE_COMPOSITOR_COMPLAINS=1
GAVE_UP_AT="$(grep -n "desktops in a row have failed" "$SAID" | tail -1 | cut -d: -f1)"
LAST_LINE_AT="$(grep -n "unknown field" "$SAID" | tail -1 | cut -d: -f1)"
LAST_SPAN_AT="$(grep -n '\^\^\^\^' "$SAID" | tail -1 | cut -d: -f1)"
TIMES="$(grep -c "unknown field" "$SAID")"

# Said live as well as at the end: five desktops each printing it, and the one
# repeat. A run that only repeated it would have swallowed the live output,
# which is what a desk that comes up on the fifth try is reading.
if [ "$TIMES" = 6 ]; then
  echo "PASS: what it said went past five times and was said once more at the end"
else
  echo "FAIL: the complaint appears $TIMES times, not 6. What it said:"
  sed 's/^/    /' "$SAID"
  FAILED=1
fi

# The ordering is the assertion. A repeat that landed anywhere but after the
# give-up is the burial this exists to undo.
if [ -n "$GAVE_UP_AT" ] && [ -n "$LAST_LINE_AT" ] && [ "$LAST_LINE_AT" -gt "$GAVE_UP_AT" ]; then
  echo "PASS: the reason is below the line that gave up, not above it"
else
  echo "FAIL: it gave up at line $GAVE_UP_AT and last said why at line"
  echo "      $LAST_LINE_AT. What it said:"
  sed 's/^/    /' "$SAID"
  FAILED=1
fi

# All of it, not just the line a grep happened to match: toml draws the key it
# could not read, and three of the six lines are that drawing.
if [ -n "$LAST_SPAN_AT" ] && [ "$LAST_SPAN_AT" -gt "$GAVE_UP_AT" ]; then
  echo "PASS: the underlined span came back with it"
else
  echo "FAIL: the repeat did not carry the whole complaint. What it said:"
  sed 's/^/    /' "$SAID"
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
