#!/usr/bin/env bash
# Tests that the history guard's fixture serves what the guard assumes.
#
# `guard-webview-history.sh` only reads page names from the browser log, so it
# cannot tell whether the fixture is right. Checked here: the three paths, a
# serial that distinguishes loads, `no-store` so a revisit is not served from
# cache, and that `/slow` is slow. The `stop()` reading depends on `/slow`
# not answering early.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$ROOT/packages/domicile-engine/scripts/lib-ports.sh"
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

# Short: this only checks that the delay exists. The guard uses a delay long
# enough to stop a navigation inside it.
SLOW_SECONDS=2

LOG="$(mktemp)"
python3 "$SERVER" --port 0 --slow-seconds "$SLOW_SECONDS" >"$LOG" 2>&1 &
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
  echo "the fixture never came up. It said:" >&2
  cat "$LOG" >&2
  exit 1
}
# Started with port 0, the fixture must print the port it got.
PORT="$(served_port "$LOG")" || {
  echo "the fixture never said which port it took. It said:" >&2
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

# The serial a page reports, read from its body. The guard reads the same
# string from the browser log.
serial_of() { # $1 body
  printf '%s' "$1" | sed -n 's/.*serial=\([0-9]*\).*/\1/p' | head -1
}

ONE="$(curl -sS -i "http://127.0.0.1:$PORT/one")"
TWO="$(curl -sS -i "http://127.0.0.1:$PORT/two")"

expect "the first page is served" "yes" \
  "$(case "$ONE" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "the second page is served" "yes" \
  "$(case "$TWO" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
# The guard's sequence is built from these names. A wrong path would read as
# the other page loading, and no later check would catch it.
expect "the first page says which page it is" "yes" \
  "$(case "$ONE" in *"guest-shown path=/one"*) echo yes ;; *) echo no ;; esac)"
expect "the second page says which page it is" "yes" \
  "$(case "$TWO" in *"guest-shown path=/two"*) echo yes ;; *) echo no ;; esac)"
# Report on `pageshow`, not at parse time: a page restored from the
# back/forward cache runs no script again.
expect "the pages report themselves on pageshow" "yes" \
  "$(case "$ONE" in *pageshow*) echo yes ;; *) echo no ;; esac)"
# A distinct serial shows a reload fetched something.
expect "a second visit has a serial of its own" "yes" \
  "$(if [ "$(serial_of "$ONE")" != "$(serial_of "$TWO")" ]; then
       echo yes
     else
       echo no
     fi)"
# Without `no-store`, a back-navigation is served from the HTTP cache.
expect "nothing is cached" "yes" \
  "$(case "$ONE" in *[Cc]ache-[Cc]ontrol:*no-store*) echo yes ;; *) echo no ;; esac)"

# The guard reads "the browser requested the slow page" from this log, so a
# request is logged on arrival, not when answered.
expect "a request is recorded when it arrives" "yes" \
  "$(case "$(cat "$LOG")" in *"asked /one"*) echo yes ;; *) echo no ;; esac)"

# Timed, not read from the source: a configured delay that is ignored looks
# the same to the guard as a page that never arrived.
BEFORE="$(date +%s)"
curl -sS -o /dev/null "http://127.0.0.1:$PORT/slow"
ELAPSED=$(($(date +%s) - BEFORE))
expect "the slow page makes the browser wait" "yes" \
  "$(if [ "$ELAPSED" -ge "$SLOW_SECONDS" ]; then echo yes; else echo no; fi)"
expect "the slow page says which page it is" "yes" \
  "$(case "$(curl -sS "http://127.0.0.1:$PORT/slow")" in
     *"guest-shown path=/slow"*) echo yes ;; *) echo no ;; esac)"

# A hang-up is logged at once, so the guard knows the slow page can no longer
# arrive without waiting out the delay.
BEFORE="$(date +%s%N)"
curl -sS -o /dev/null --max-time 0.5 "http://127.0.0.1:$PORT/slow" 2>/dev/null
for _ in $(seq 1 30); do
  grep -q "abandoned /slow" "$LOG" && break
  sleep 0.05
done
ELAPSED_MS=$((($(date +%s%N) - BEFORE) / 1000000))
expect "a slow page the browser gave up on is recorded before its wait is over" \
  "yes" "$(if grep -q "abandoned /slow" "$LOG" &&
    [ "$ELAPSED_MS" -lt "$((SLOW_SECONDS * 1000))" ]; then
    echo yes
  else
    echo no
  fi)"

# Only three paths: answering everything would hide a mistyped path in the
# guard.
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
