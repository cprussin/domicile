#!/usr/bin/env bash
# Checks that a browser window's page unloads when SIGTERM ends the engine, and
# that one which never returns holds the exit up only so long.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-exit-unload.sh /build/chromium/src
#
# Chromium's SIGTERM runs `SessionEnding()`, which runs no `pagehide`. Patch
# 0278 unloads the pages first. Two engines run, one after the other, on one
# profile. The first's page holds a lock in localStorage, which it gives up in
# `pagehide`, and the second's says whether it found the lock. A second page
# hangs in its `pagehide`.
#
# It also checks that no window closed: one that did would not open again in
# the next session.
#
# Control: NEGATIVE=1 ends the first engine with SIGKILL. The lock must be
# held, which proves the guard can find one.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-exit-unload: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-exit-unload$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-exit-unload$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-exit-unload$WHICH-engine.log}"
FIRST_LOG="${ENGINE_LOG%.log}-first.log"
SECOND_LOG="${ENGINE_LOG%.log}-second.log"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-exit-unload$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# Longer than Chromium waits before it writes a localStorage change, so the
# control's lock is on disk when it is killed.
HOLD_SECONDS="${HOLD_SECONDS:-12}"
# The launcher's `TO_STOP`, after which it kills the engine.
TO_EXIT_SECONDS="${TO_EXIT_SECONDS:-15}"

ENGINE=""
SERVER=""
cleanup() {
  [ -n "$ENGINE" ] && kill -KILL "$ENGINE" 2>/dev/null
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-exit-unload: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-exit-unload: no python3, which serves the pages"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-exit-unload-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
SERVER=$!
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-exit-unload: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-exit-unload: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
# Two sites, so that the hung page's process is its own.
LOCK="http://127.0.0.1:$PORT/lock"
HUNG="http://localhost:$PORT/hung"

rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# Starts an engine and waits for both pages. No early exit when they never
# come: the verdict says why.
start() { # $1 log
  fresh_broker
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --window-size=1024,768 \
    --app="domicile://shell/?lock=$LOCK&hung=$HUNG" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-exit-unload.js" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
    --user-data-dir="$PROFILE" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$1" 2>&1 &
  ENGINE=$!
  wait_for_line $((FOR_SECONDS * 4)) '"GUARD lock-was=' "$1"
  wait_for_line $((FOR_SECONDS * 4)) '"GUARD hung-loaded"' "$1"
}

rm -f "$FIRST_LOG" "$SECOND_LOG"
start "$FIRST_LOG"
sleep "$HOLD_SECONDS"
SIGNAL=TERM
[ "$NEGATIVE" = "1" ] && SIGNAL=KILL
kill "-$SIGNAL" "$ENGINE"
# A hung engine is killed, and its status says so.
( sleep "$TO_EXIT_SECONDS"; kill -KILL "$ENGINE" 2>/dev/null ) &
WATCHDOG=$!
wait "$ENGINE"
STATUS=$?
kill "$WATCHDOG" 2>/dev/null
ENGINE=""

start "$SECOND_LOG"

# The lock as a log's page found it: `held`, `free`, or empty.
lock_was() { # $1 log
  sed -n 's/.*"GUARD lock-was=\([a-z]*\)".*/\1/p' "$1" 2>/dev/null | head -1
}
saw() { # $1 log, $2 fixed string
  grep -qF -- "$2" "$1" 2>/dev/null && echo 1 || echo 0
}
SAW_SHELL="$(saw "$FIRST_LOG" '"GUARD shell-loaded"')"
SAW_HUNG="$(saw "$FIRST_LOG" '"GUARD hung-loaded"')"
SAW_HIDING="$(saw "$FIRST_LOG" '"GUARD hung-hiding"')"
CLOSED="$(saw "$FIRST_LOG" 'domicile: closed browser window')"
FIRST="$(lock_was "$FIRST_LOG")"
SECOND="$(lock_was "$SECOND_LOG")"

echo "lock at the first start: ${FIRST:-none}; at the second: ${SECOND:-none}; exit status: $STATUS; a window closed: $CLOSED"

PASSED=""
FAILURE=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell never ran"
elif [ "$FIRST" != "free" ] || [ "$SAW_HUNG" != "1" ]; then
  FAILURE="the first engine's pages never loaded, or its profile was not new"
elif [ -z "$SECOND" ]; then
  FAILURE="the second engine's page never loaded"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SECOND" = "held" ]; then
    PASSED="the control is sharp: a page SIGKILL ended left its lock"
  else
    FAILURE="THE CONTROL FOUND NO LOCK: localStorage was not written before \
SIGKILL, so the claim's free lock says nothing"
  fi
elif [ "$STATUS" != "0" ]; then
  FAILURE="SIGTERM did not end the engine (exit status $STATUS, 137 if it was \
still running after ${TO_EXIT_SECONDS}s): the hung page held it up, or it \
crashed"
elif [ "$SAW_HIDING" != "1" ]; then
  FAILURE="the hung page never entered its pagehide, so that it held nothing \
up says nothing"
elif [ "$SECOND" != "free" ]; then
  FAILURE="THE PAGE KEPT ITS LOCK: its pagehide never ran (patch 0278, \
LetPagesUnload), or what it wrote was not flushed"
elif [ "$CLOSED" != "0" ]; then
  FAILURE="the exit closed a window, which the next session will not open \
(WebViewGuest::CloseContents)"
else
  PASSED="SIGTERM lets a page unload and write its storage, a page that never \
returns does not hold it up, and no window closes"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-exit-unload$WHICH: $FAILURE"
for log in "$FIRST_LOG" "$SECOND_LOG"; do
  echo "the last words in $log:" >&2
  last_words "$log" >&2
done
exit 1
