#!/usr/bin/env bash
# Checks that a page in a browser window asking to be in front fires
# `domicile-focus-request` in the shell's document.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-activate.sh /build/chromium/src
#
# - A site answers a click on its notification with `client.focus()` or
#   `window.focus()`. Both call `WebContents::Activate()`, which calls
#   `WebViewGuest::ActivateContents`.
# - There is no session bus here, so `Page.bringToFront` on the guest is the
#   press. It calls the same `Activate()`. See guard-webview-activate-front.py.
# - Headless and software-composited, like guard-webview-click.sh.
# - Control (`NEGATIVE=1`): bring the shell's own page to the front. No request
#   may reach the shell, or the positive run's request proves nothing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-activate: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
FRONTED="guest"
[ "$NEGATIVE" = "1" ] && FRONTED="shell"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-activate-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-activate-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-activate$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-activate$WHICH-http.log}"
FRONT_LOG="${FRONT_LOG:-/tmp/domicile-webview-activate$WHICH-front.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-activate: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-activate: no python3, and the page in the window and the front are both driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-activate: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-activate: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"
echo "serving a browser window's page at $SUBJECT"

# 2. The engine, showing the shell module as a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-activate.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-activate: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# 3. The front: the window's page, or in the control the shell's own.
BROUGHT=0
python3 "$SCRIPTS/guard-webview-activate-front.py" \
  --port "$DEBUG_PORT" --target "$FRONTED" >"$FRONT_LOG" 2>&1 &&
  grep -qF "brought-to-front target=$FRONTED" "$FRONT_LOG" && BROUGHT=1

# The request fires after the command returns, and the control waits for an
# absence, so this is a fixed wait.
sleep 5

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_REQUEST=$(saw "GUARD focus-request target=webview")
# Logged by WebViewGuest::ActivateContents. Tells a missing call apart from an
# event the element did not dispatch.
SAW_ASKED=$(saw "domicile: a <webview>'s page asked to be in front.")

echo
echo "shell=$SAW_SHELL loaded=$SAW_PAGE brought=$BROUGHT target=$FRONTED"
echo "the engine asked=$SAW_ASKED; the shell heard=$SAW_REQUEST"
echo

# The verdict. `scripts/test-webview-activate-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the harness did not load the module, or \
it threw"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing loaded in the window: the guest was not created, \
attached or navigated"
elif [ "$BROUGHT" != "1" ]; then
  FAILURE="Page.bringToFront failed, so nothing was fronted. This is the \
harness; the front log says why"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_REQUEST" = "1" ]; then
    FAILURE="fronting the shell's own page fired a request too, so the positive \
run's request says nothing about the guest"
  else
    PASSED="fronting the shell's own page fires no request"
  fi
elif [ "$SAW_REQUEST" = "1" ]; then
  PASSED="fronting a browser window's page fires domicile-focus-request"
elif [ "$SAW_ASKED" = "1" ]; then
  FAILURE="WebViewGuest asked, but the shell heard nothing: the element did \
not dispatch domicile-focus-request, or used another name than the SDK's \
WEBVIEW_FOCUS_REQUEST_EVENT"
else
  FAILURE="the page was fronted and WebViewGuest never asked the shell: \
WebViewGuest does not override ActivateContents"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-activate: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the front did:" >&2
tail -20 "$FRONT_LOG" >&2
exit 1
