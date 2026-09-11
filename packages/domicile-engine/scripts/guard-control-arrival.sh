#!/usr/bin/env bash
# The hop from the compositor's socket into a page, measured — and the cursor's
# closed set, read end to end.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-control-arrival.sh /build/chromium/src
#
# WHY THIS EXISTS. `ENGINE-FORK.md`'s phase 2 asks for an arrival stamp on the
# control channel's events, and the reason it asks is that the stage between the
# compositor and a listener — a read in the browser process, a mojo message, the
# hop into the renderer, the dispatch — was unmeasurable from a page. The
# instrument that claimed to measure it was deleted because it always reported
# zero: it subtracted `Event.timeStamp` from a clock, and `timeStamp` is when
# the event was *constructed*, in the renderer, at dispatch. So the shell
# printed `ipc_ms=0` every interval, which is a measurement to whoever read the
# log. A stamp that exists and is never filled in fails exactly the same way,
# which is why this guard reads its shape and not only its value.
#
# NO WAYLAND, NO CLIENT, NO GPU, NO WINDOW. Every other guard here needs a
# compositor, a client drawing a colour, or a browser window with a guest in it.
# This one needs a socket with something on the far end and a page that can
# hear it, and nothing else — which is what makes it cheap enough to run beside
# the others and what keeps its failures about the control channel.
#
# WHAT IT ASSERTS, and the last of these is what makes the third worth
# anything:
#
#   a cursor the engine knows reaches the page, named
#   a cursor it does not know does NOT reach the page
#   and one it knows, sent after the one it does not, reaches it anyway — so
#     "the bad name was refused" can be told apart from "the channel died on
#     it", which without this reading are the same absence
#   `arrival` is a finite number, after the document's time origin, and not
#     after the dispatch it precedes
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-control-arrival: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: two guards on one socket is two guards that
# cannot run in the same job, and CI runs them in one.
BROKER="${BROKER:-/tmp/domicile-control-arrival-broker}"
CONTROL="${CONTROL:-/tmp/domicile-control-arrival-control}"
PROFILE="${PROFILE:-/tmp/domicile-control-arrival-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-control-arrival-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-control-arrival-socket.log}"

# The page loads, binds the channel, and hears three lines a quarter of a second
# apart. Generous against that, because every step is asynchronous and this
# machine is shared.
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-control-arrival: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-control-arrival: no python3, and the compositor's end of the control socket is one"
  exit 77
}

rm -f "$BROKER" "$CONTROL"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter seconds. Every gate here is
# a line in a log, because every one of them is something a page or a browser
# says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The compositor's end. It accepts, answers `hello` with a `welcome`, and
#    then writes the three lines this guard is about — which is the half
#    guard-webview-keyboard-socket.py deliberately does not do.
python3 "$SCRIPTS/guard-control-arrival-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-control-arrival: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 2. The engine, on a domicile:// document, because the browser binds the
#    control channel for that origin and no other. `--app` for the reason every
#    guard here repeats: the guard runs the configuration the product runs, or
#    it is guarding something else. Headless and without the GPU because nothing
#    here is measured in pixels.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-control-arrival.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-control-arrival: the shell module never ran, so nothing below was measured" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell is listening on the control channel"

# The last thing the stand-in sends. Waiting for the page to report it is what
# ends the run: waiting a fixed time would either be slower than it needs to be
# or shorter than the machine, and the third cursor is the one every reading
# below depends on having had its chance to arrive.
wait_for_line "$TRIES" "GUARD app-cursor app=guard cursor=zoom-out" "$ENGINE_LOG" ||
  echo "the last cursor never reached the page; the verdict below says what that means" >&2

# A moment for anything already dispatched to be written out. Lines are the only
# evidence here and the process is about to be killed.
sleep 1

# THE READINGS, AND THE CLOSING QUOTE IS LOAD-BEARING. A console line reaches
# this log wrapped by Chromium:
#
#   [...:INFO:CONSOLE:48] "GUARD app-cursor app=guard cursor=grab", source: ...
#
# so a `GUARD` line never ends where the message does. Anchoring these on `$`
# is how the first version of this guard read every one of them as absent on a
# run where all of them were present -- and, far worse, read `pointr` as absent
# for a reason that had nothing to do with the cursor being refused. That
# reading could not have failed, which is the one thing a check must be able to
# do.
#
# So the terminator is the quote Chromium puts after the message. It cannot be
# dropped either: `grab` is a prefix of `grabbing` and `zoom-in` of nothing but
# itself only by luck, so an unanchored match would let one shape answer for
# another. The quote also keeps these off the engine's OWN warning about an
# unknown cursor, which lands in this same log unquoted -- a reading that
# matched it would report the refusal as the failure it prevents.
#
# scripts/test-control-arrival-guard.sh drives this block over a recorded log
# rather than over invented variables, which is the gap that let the anchors
# through.
saw() { # $1 extended regular expression
  grep -qE "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

LISTENING=$(saw '"GUARD listening"')
KNOWN_FIRST=$(saw '"GUARD app-cursor app=guard cursor=grab"')
KNOWN_AFTER=$(saw '"GUARD app-cursor app=guard cursor=zoom-out"')
UNKNOWN=$(saw '"GUARD app-cursor app=guard cursor=pointr"')
FINITE=$(saw '"GUARD hop-shape finite=true ')
POSITIVE=$(saw '"GUARD hop-shape finite=[a-z]+ positive=true ')
ORDERED=$(saw '"GUARD hop-shape .*ordered=true"')

echo "listening=$LISTENING grab=$KNOWN_FIRST zoom-out=$KNOWN_AFTER" \
  "pointr=$UNKNOWN finite=$FINITE positive=$POSITIVE ordered=$ORDERED"

# THE VERDICT, AND IT IS ORDERED. Each arm rules out a layer, and an arm that
# answered out of turn would name the wrong one in a true-sounding sentence —
# which is a CI cycle spent on the wrong end. scripts/test-control-arrival-guard.sh
# drives this block out of this file, so a rewrite that moves it fails there
# rather than leaving that test passing against a version nobody ships.
FAILURE=""
if [ "$LISTENING" != "1" ]; then
  FAILURE="the shell module never registered a listener, so nothing here was measured"
elif [ "$UNKNOWN" = "1" ]; then
  FAILURE="a cursor name the engine does not know reached the page, so the closed set in components/domicile/common/cursor_shape.h is not being applied and an unknown CSS keyword is a silent no-op there"
elif [ "$KNOWN_FIRST" != "1" ]; then
  FAILURE="a cursor the engine knows was sent down the control socket and never reached the page: the browser did not read it, did not forward it, or Blink did not dispatch it"
elif [ "$KNOWN_AFTER" != "1" ]; then
  FAILURE="the cursor sent after the unknown one never arrived, so the unknown name was not refused but fatal: the channel stopped on it"
elif [ "$FINITE" != "1" ]; then
  FAILURE="event.arrival is not a finite number, so the attribute is absent or was never filled in and every hop figure in the log is arithmetic on undefined"
elif [ "$POSITIVE" != "1" ]; then
  FAILURE="event.arrival is zero, which is a stamp nothing wrote into — the exact shape of the instrument that was deleted for reporting ipc_ms=0 every interval"
elif [ "$ORDERED" != "1" ]; then
  FAILURE="event.arrival is later than the dispatch it precedes, so the browser's stamp and this document's clock are not the same clock and the difference is not a duration"
fi

if [ -n "$FAILURE" ]; then
  annotate_from "guard-control-arrival: $FAILURE" "$ENGINE_LOG"
  echo "guard-control-arrival: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi

echo "the hop, as the page measured it:"
grep -F "GUARD hop " "$ENGINE_LOG" >&2 || true
echo "guard-control-arrival: the stage is measurable and the cursor set is closed"
