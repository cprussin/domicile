#!/usr/bin/env bash
# Does the find guard's fixture hold the count the guard expects?
#
# `guard-webview-find.sh` asserts that a find counts three matches, and the
# engine guard cannot check where those three are: it reads a number out of a
# browser's log, and a fixture that held two, or four, or put the third in a
# same-site frame, would make a plausible count that measured something else.
# The cross-site frame is the sharpest of these — it is the one match the
# element's own renderer could never have counted, and a frame on the page's
# own site is in the page's own process.
#
# So the fixture is asserted here, where it is free rather than thirty minutes
# on a shared tree.
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

# How many times the word is in a body, outside its <script>: what a find
# would see, give or take a renderer.
count() { # $1 body
  printf '%s\n' "$1" | sed '/<script>/,/<\/script>/d' | grep -o "$WORD" | grep -c .
}

WORDS="$(curl -sS -i "http://127.0.0.1:$PORT/words")"
# The frame is fetched where the page points it, which is the point.
FRAME_SRC="$(printf '%s\n' "$WORDS" | sed -n 's/.*<iframe src="\([^"]*\)".*/\1/p')"
FRAMED="$(curl -sS "$FRAME_SRC")"
ELSEWHERE="$(curl -sS "http://127.0.0.1:$PORT/elsewhere")"

expect "the page to search holds the word twice" "2" "$(count "$WORDS")"
# ANOTHER SITE, NOT ANOTHER ORIGIN: two ports of one host are one site and
# would share the page's process.
expect "its frame is on another site" "http://localhost:$PORT/framed" \
  "$FRAME_SRC"
expect "and holds the word once more" "1" "$(count "$FRAMED")"
expect "the page after it holds none" "0" "$(count "$ELSEWHERE")"
expect "the page to search says which it is" "yes" \
  "$(case "$WORDS" in *"guest-shown path=/words"*) echo yes ;; *) echo no ;; esac)"
expect "the page after it says which it is" "yes" \
  "$(case "$ELSEWHERE" in *"guest-shown path=/elsewhere"*) echo yes ;; *) echo no ;; esac)"
# On `load`, which waits for the frame: a count read the moment the page said
# it was there would otherwise race the third match.
expect "the pages report themselves once their frames are in" "yes" \
  "$(case "$WORDS" in *'addEventListener("load"'*) echo yes ;; *) echo no ;; esac)"
expect "nothing is cached" "yes" \
  "$(case "$WORDS" in *[Cc]ache-[Cc]ontrol:*no-store*) echo yes ;; *) echo no ;; esac)"
# The guard reads "the frame was asked for" out of this log.
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
