#!/usr/bin/env bash
# Checks that a <webview> says when its page keeps the screens on, so a shell
# can name the site.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-wake-lock.sh /build/chromium/src
#
# - The page takes a screen wake lock as it loads and releases it 3 seconds
#   later. Patch 0158 counts it in content's WakeLockServiceImpl, WebViewGuest
#   hears ScreenWakeLockChanged, and the element reports `wakeLock` with
#   `domicile-wake-lock-change`. The shell must hear true, then false.
# - Headless: a wake lock draws nothing. A unit test cannot check this:
#   happy-dom has no nested browsing context.
# - Control (`NEGATIVE=1`): the page asks for nothing. The shell must hear no
#   change, or the positive run's could come from the load.
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
  annotate "guard-webview-wake-lock: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
PAGE="page"
[ "$NEGATIVE" = "1" ] && PAGE="plain"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-wake-lock-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-wake-lock-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-wake-lock$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-wake-lock$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-wake-lock: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-wake-lock: no python3, and the page in the window is served by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-wake-lock-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-wake-lock: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-wake-lock: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/$PAGE"

# 2. The engine, showing the shell module as a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-wake-lock.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran" >&2
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

HELD_LINE="GUARD webview-wake-lock=true"
LET_GO_LINE="GUARD webview-wake-lock=false"
if [ "$NEGATIVE" = "1" ]; then
  # A fixed wait, not a poll, because the control expects an absence.
  sleep 5
else
  wait_for_line "$TRIES" "$HELD_LINE" "$ENGINE_LOG" ||
    echo "the shell never heard the page keep the screens on" >&2
  wait_for_line "$TRIES" "$LET_GO_LINE" "$ENGINE_LOG" ||
    echo "the shell never heard the page let the screens go" >&2
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_REFUSED=$(saw "GUARD page-wake-lock refused")
SAW_PAGE_HELD=$(saw "GUARD page-wake-lock held")
SAW_PAGE_RELEASED=$(saw "GUARD page-wake-lock released")
SAW_HELD=$(saw "$HELD_LINE")
SAW_LET_GO=$(saw "$LET_GO_LINE")
SAW_ANY=$(saw "GUARD webview-wake-lock")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "page: refused=$SAW_REFUSED held=$SAW_PAGE_HELD released=$SAW_PAGE_RELEASED"
echo "shell heard: held=$SAW_HELD let-go=$SAW_LET_GO any=$SAW_ANY"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-wake-lock-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the harness did not load the module, or \
it threw"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing loaded in the window. That is the guest: it was not made, \
attached or navigated"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY" = "1" ]; then
    FAILURE="a page that asked for nothing reported a wake lock, so the \
positive run's report may come from the load rather than the lock"
  else
    PASSED="a page that asks for nothing reports no wake lock"
  fi
elif [ "$SAW_REFUSED" = "1" ]; then
  FAILURE="the page's navigator.wakeLock.request() was refused: the \
screen-wake-lock permission or the page's visibility, before the browser \
counted anything"
elif [ "$SAW_PAGE_HELD" != "1" ]; then
  FAILURE="the page's navigator.wakeLock.request() never settled"
elif [ "$SAW_HELD" != "1" ]; then
  FAILURE="the page held a wake lock and the shell never heard. Either patch \
0158's CountedWakeLock never told WebViewGuest::ScreenWakeLockChanged, or \
WakeLockChanged never reached the element"
elif [ "$SAW_PAGE_RELEASED" != "1" ]; then
  FAILURE="the page never released its wake lock, so letting go was not \
measured"
elif [ "$SAW_LET_GO" != "1" ]; then
  FAILURE="the page released its wake lock and the shell still thinks it is \
held, so a shell would name a site that no longer keeps the screens on. \
CountedWakeLock::CancelWakeLock must count it off"
else
  PASSED="the shell heard the page keep the screens on, then let them go"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-wake-lock: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
