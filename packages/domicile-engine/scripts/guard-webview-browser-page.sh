#!/usr/bin/env bash
# Checks that chrome://history in a browser window is refused, not fatal.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-browser-page.sh /build/chromium/src
#
# Headless and software-composited, like guard-webview-escape.sh: nothing is
# measured in pixels.
#
# HistoryUI assumes it is in a tab. A <webview> guest is not, so without patch
# 0083 `tabs::TabInterface::GetFromContents` crashes the browser process. Many
# chrome:// pages behave like this and none is useful on a desktop, so patch
# 0083's BrowserPageThrottle (//components/domicile) refuses them all in
# guests.
#
# Asserts, in order (each only meaningful if the previous holds):
#
#   there is a page in the window     an ordinary page loaded first, so a
#                                      guest works and a failure is not read as
#                                      a refusal
#   nothing dumped a signal           the crash this guards against
#   the throttle refused it           its own log line, so an unrelated failure
#                                      is not credited to the fork
#   the browser still answers         it may die without dumping a signal
#
# NEGATIVE=1 navigates to the same page under another host instead. It must
# load and the refusal must not appear, which catches a throttle that refuses
# everything.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-browser-page: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 navigates to an ordinary page instead. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-browser-page-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-browser-page-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the shell gets to load, attach a guest and navigate twice. Generous:
# each step is asynchronous and the machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long the browser gets to dump a stack after the second navigation. See
# guard-webview-escape.sh.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-browser-page$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-browser-page$WHICH-http.log}"

# BrowserPageThrottle's own line.
REFUSED="domicile: a <webview> was refused a page Chrome serves itself"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-browser-page: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-browser-page: no python3, and the page in the window is served by one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The ordinary page, shared with the keyboard and Escape guards.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-browser-page: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-browser-page: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The second address: the one under test, or in the control the same page
#    under another host, so it is a new document the throttle sees.
if [ "$NEGATIVE" = "1" ]; then
  THEN="http://localhost:$PORT/page"
else
  THEN="chrome://history/"
fi
echo "a browser window on $SUBJECT, then $THEN"

# 3. The engine, on a domicile:// document. `--remote-debugging-port` lets
#    the guard check the browser is still alive.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT&then=$THEN" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-browser-page.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!
STARTED+=("$ENGINE")

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-browser-page: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 4. Wait for the outcome (refusal in the run, a second load in the control,
#    or a signal in either), then settle so a stack can land.
for _ in $(seq 1 "$TRIES"); do
  grep -qF "$REFUSED" "$ENGINE_LOG" 2>/dev/null && break
  grep -qF "Received signal" "$ENGINE_LOG" 2>/dev/null && break
  [ "$(grep -cF "GUARD guest-loaded" "$ENGINE_LOG" 2>/dev/null)" -ge 2 ] && break
  sleep 0.25
done
sleep "$SETTLE_SECONDS"

ANSWERED=0
python3 -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=10)' \
  "http://127.0.0.1:$DEBUG_PORT/json/list" 2>/dev/null && ANSWERED=1

LOADS="$(grep -cF "GUARD guest-loaded" "$ENGINE_LOG" 2>/dev/null)"
SAW_GUEST=$([ "$LOADS" -ge 1 ] && echo 1 || echo 0)
SAW_SECOND=$([ "$LOADS" -ge 2 ] && echo 1 || echo 0)
SAW_REFUSAL=$(grep -qF "$REFUSED" "$ENGINE_LOG" && echo 1 || echo 0)
SAW_CRASH=$(grep -qF "Received signal" "$ENGINE_LOG" && echo 1 || echo 0)

echo
echo "guest=$SAW_GUEST second=$SAW_SECOND refusal=$SAW_REFUSAL crash=$SAW_CRASH answered=$ANSWERED"
echo

# The verdict. `scripts/test-webview-browser-page-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
if [ "$SAW_GUEST" != "1" ]; then
  FAILURE="nothing ever loaded in the browser window, so no guest was made \
and the second address was never asked for. Nothing here was measured. That is \
the guest: it was not made, not attached, or not navigated"
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. The last time a browser window was \
asked for chrome://history, HistoryUI looked up a tab its guest was not in, in \
tabs::TabInterface::GetFromContents; patch 0083's BrowserPageThrottle is what \
refuses it. Read the dumped stack before assuming it is the same one"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_REFUSAL" = "1" ]; then
    FAILURE="the control navigated to an ordinary page and the refusal was \
logged anyway, so the throttle refuses more than Chrome's own pages, or the \
line is not the throttle's. The run's refusal is then no reading"
  elif [ "$SAW_SECOND" != "1" ]; then
    FAILURE="the control's second page never loaded, so a second navigation \
in this window was never shown to work and the run's refusal could be any \
navigation failing. That is the shell's handing on of \`then\`, or the page"
  elif [ "$ANSWERED" != "1" ]; then
    FAILURE="the control's browser stopped answering its debugging port with \
no signal, so the run's liveness reading cannot be trusted either"
  else
    PASSED="the control is sharp: an ordinary second page loads in the same \
window and nothing is refused, so the run's refusal is about the address"
  fi
elif [ "$SAW_REFUSAL" != "1" ]; then
  FAILURE="chrome://history was not refused. BrowserPageThrottle never \
logged, so it is not registered for this guest, or patch 0083 is not in this \
engine"
elif [ "$ANSWERED" != "1" ]; then
  FAILURE="no signal was dumped and the browser stopped answering the \
debugging port anyway, so it went away without saying why. Read the end of the \
engine's log"
else
  PASSED="chrome://history, asked for in a browser window, was refused by \
the throttle, dumped no signal and left the browser running"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-browser-page: $FAILURE"
# The fatal message and the top of its stack. A plain tail of the log shows
# only the message loop.
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
