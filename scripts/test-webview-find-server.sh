#!/usr/bin/env bash
# Tests that the find guard's fixture holds the three matches the guard
# expects.
#
# `guard-webview-find.sh` only reads a count from the browser log, so it cannot
# tell whether the fixture is right. The third match must be in a cross-site
# frame: only that one is out of the guest renderer's process.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$ROOT/packages/domicile-engine/scripts/lib-ports.sh"
SERVER="$ROOT/packages/domicile-engine/scripts/guard-webview-find-server.py"
[ -f "$SERVER" ] || {
  echo "no server at $SERVER" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what serves the find guard's fixture"
  exit 77
}
command -v curl >/dev/null || {
  echo "SKIP: no curl to ask the fixture with"
  exit 77
}

WORD="quokkaish"

LOG="$(mktemp)"
python3 "$SERVER" --port 0 --word "$WORD" >"$LOG" 2>&1 &
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

# How many times the word appears in a body outside its <script>, roughly what
# a find sees.
count() { # $1 body
  printf '%s\n' "$1" | sed '/<script>/,/<\/script>/d' | grep -o "$WORD" | grep -c .
}

WORDS="$(curl -sS -i "http://127.0.0.1:$PORT/words")"
# Fetch the frame from the URL the page uses.
FRAME_SRC="$(printf '%s\n' "$WORDS" | sed -n 's/.*<iframe src="\([^"]*\)".*/\1/p')"
FRAMED="$(curl -sS "$FRAME_SRC")"
ELSEWHERE="$(curl -sS "http://127.0.0.1:$PORT/elsewhere")"

expect "the page to search holds the word twice" "2" "$(count "$WORDS")"
# Another site, not just another origin: two ports of one host are one site
# and share a process.
expect "its frame is on another site" "http://localhost:$PORT/framed" \
  "$FRAME_SRC"
expect "and holds the word once more" "1" "$(count "$FRAMED")"
expect "the page after it holds none" "0" "$(count "$ELSEWHERE")"
expect "the page to search says which it is" "yes" \
  "$(case "$WORDS" in *"guest-shown path=/words"*) echo yes ;; *) echo no ;; esac)"
expect "the page after it says which it is" "yes" \
  "$(case "$ELSEWHERE" in *"guest-shown path=/elsewhere"*) echo yes ;; *) echo no ;; esac)"
# The page reports itself on `load`, which waits for the frame, so the count
# includes the third match.
expect "the pages report themselves once their frames are in" "yes" \
  "$(case "$WORDS" in *'addEventListener("load"'*) echo yes ;; *) echo no ;; esac)"
expect "nothing is cached" "yes" \
  "$(case "$WORDS" in *[Cc]ache-[Cc]ontrol:*no-store*) echo yes ;; *) echo no ;; esac)"
# The guard reads "the frame was requested" from this log.
expect "a frame asked for is in the log" "yes" \
  "$(grep -qF "GET /framed " "$LOG" && echo yes || echo no)"
expect "anything else is a 404" "404" \
  "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the find guard's fixture holds three of its word, one across sites"
  exit 0
fi
echo "$FAILED assertion(s) wrong" >&2
exit 1
