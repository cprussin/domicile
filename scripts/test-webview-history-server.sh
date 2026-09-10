#!/usr/bin/env bash
# Does the history guard's fixture serve the three pages the guard reads?
#
# `guard-webview-history.sh` rests on three premises about this server, and the
# engine guard cannot check any of them: it reads a sequence of page names out
# of a browser's log, and a fixture that served the wrong path, cached its own
# answer, or answered `/slow` immediately would produce a plausible sequence
# that measured nothing. `/slow` is the sharpest of the three — the whole
# reading of `stop()` is that a navigation which WOULD have landed did not, so
# a fixture that answers it at once turns the positive run's pass into an
# accident of timing.
#
# So the fixture is asserted here, where it is free rather than thirty minutes
# on a shared tree: the three paths, the serial that makes one load tell itself
# apart from the next, the `no-store` that keeps a second visit from being the
# first one's answer out of the cache, and that `/slow` is actually slow.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/packages/domicile-engine/scripts/guard-webview-history-server.py"
[ -f "$SERVER" ] || {
  echo "no server at $SERVER" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what serves the history guard's fixture"
  exit 77
}
command -v curl >/dev/null || {
  echo "SKIP: no curl to ask the fixture with"
  exit 77
}

# Not the guard's own port, and not the framing fixture's test port either:
# these all run on every pull request and two of them on one number cannot
# overlap.
PORT="${PORT:-8734}"
# Short, because what is asserted is that the wait exists rather than how long
# it is. The guard runs with a wait long enough to stop a navigation inside.
SLOW_SECONDS=2

LOG="$(mktemp)"
python3 "$SERVER" --port "$PORT" --slow-seconds "$SLOW_SECONDS" >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  rm -f "$LOG"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  grep -q "serving" "$LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$LOG" 2>/dev/null || {
  echo "the fixture never came up on port $PORT. It said:" >&2
  cat "$LOG" >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# The serial a page reports, out of the page itself. The guard reads these
# names from a browser's log; this reads them from the body, which is the same
# string and one layer earlier.
serial_of() { # $1 body
  printf '%s' "$1" | sed -n 's/.*serial=\([0-9]*\).*/\1/p' | head -1
}

ONE="$(curl -sS -i "http://127.0.0.1:$PORT/one")"
TWO="$(curl -sS -i "http://127.0.0.1:$PORT/two")"

expect "the first page is served" "yes" \
  "$(case "$ONE" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "the second page is served" "yes" \
  "$(case "$TWO" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
# The name the guard's whole sequence is built from. A page that reported the
# wrong path would read as the other page having loaded, which is the one
# mistake no verdict downstream could catch.
expect "the first page says which page it is" "yes" \
  "$(case "$ONE" in *"guest-shown path=/one"*) echo yes ;; *) echo no ;; esac)"
expect "the second page says which page it is" "yes" \
  "$(case "$TWO" in *"guest-shown path=/two"*) echo yes ;; *) echo no ;; esac)"
# `pageshow` rather than a line at parse time, because a page restored from the
# back/forward cache runs no script again and would go unreported — which is
# precisely the navigation the guard is about.
expect "the pages report themselves on pageshow" "yes" \
  "$(case "$ONE" in *pageshow*) echo yes ;; *) echo no ;; esac)"
# A second visit must be able to tell itself from the first: it is what says a
# reload fetched something rather than nothing happening at all.
expect "a second visit has a serial of its own" "yes" \
  "$(if [ "$(serial_of "$ONE")" != "$(serial_of "$TWO")" ]; then
       echo yes
     else
       echo no
     fi)"
# Without this a back-navigation is answered out of the HTTP cache, and a
# fixture whose second answer is the first one's bytes tells the guard nothing
# it can trust about when a load happened.
expect "nothing is cached" "yes" \
  "$(case "$ONE" in *[Cc]ache-[Cc]ontrol:*no-store*) echo yes ;; *) echo no ;; esac)"

# The guard reads "the browser asked for the slow page" out of this log, and
# reads it as having happened when the request ARRIVED — which for a page the
# server sits on for twenty seconds is not when it was answered.
expect "a request is recorded when it arrives" "yes" \
  "$(case "$(cat "$LOG")" in *"asked /one"*) echo yes ;; *) echo no ;; esac)"

# THE ONE THE WHOLE READING OF stop() RESTS ON. Timed rather than read out of
# the source: a wait that was configured and not honoured looks identical from
# the guard, which only ever sees a page that did not arrive.
BEFORE="$(date +%s)"
curl -sS -o /dev/null "http://127.0.0.1:$PORT/slow"
ELAPSED=$(($(date +%s) - BEFORE))
expect "the slow page makes the browser wait" "yes" \
  "$(if [ "$ELAPSED" -ge "$SLOW_SECONDS" ]; then echo yes; else echo no; fi)"
expect "the slow page says which page it is" "yes" \
  "$(case "$(curl -sS "http://127.0.0.1:$PORT/slow")" in
     *"guest-shown path=/slow"*) echo yes ;; *) echo no ;; esac)"

# Three pages and no more: a server that answered everything would answer a
# mistyped path too, and the guard would never learn it had mistyped one.
expect "anything else is a 404" "yes" \
  "$(case "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" in
     404) echo yes ;; *) echo no ;; esac)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the history guard's fixture serves three pages that say which they are"
  exit 0
fi
echo "$FAILED assertion(s) wrong" >&2
exit 1
