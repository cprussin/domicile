#!/usr/bin/env bash
# A page in a browser window fails to load, the element reports why, and the
# engine draws no error page of its own (patch 0180).
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-page-failure.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-click.sh: nothing here
# is measured in pixels, and nothing is pressed.
#
# Chrome draws its own error page (the dinosaur), its "This page isn't
# working" page and its certificate and Safe Browsing warnings inside the
# page. The guest now reports the failure to its element as
# PageFailureChanged, which fires `domicile-page-failure-change`, and the
# shell draws the page. A unit test cannot check this: happy-dom has no guest
# and no network stack.
#
# The pages are guard-webview-page-failure-server.py's. The shell walks the
# window through /empty-500 (an HTTP error with nothing to show), /drop (no
# answer at all) and /ok, moving on at each failure.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   the server was asked             the guest was made, attached and
#                                     navigated
#   the browser reported a failure   WebViewGuest saw the error page commit
#   the shell heard the HTTP error   as "http", status 500
#   the shell heard the network one  as "network", ERR_EMPTY_RESPONSE
#   the failure cleared              the page that loaded reported none
#
# NEGATIVE=1 is the control: the window loads /ok alone. No failure may be
# reported, or the positive run's could come from the load itself.
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
  annotate "guard-webview-page-failure: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-page-failure-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-page-failure-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Height of the shell's strip in CSS pixels.
#
# Not `STRIP`: `nix develop .#full` exports `STRIP=strip`. See
# guard-webview-external-app.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"

# Time for the shell to load and its guest to attach and navigate, and for
# each report the positive run waits on.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-page-failure$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-page-failure$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-page-failure: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-page-failure: no python3, and the page in the window is served by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages: one local server, because `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-page-failure-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-page-failure: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-page-failure: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
WALK="src=$SITE/empty-500&then=$SITE/drop&last=$SITE/ok"
[ "$NEGATIVE" = "1" ] && WALK="src=$SITE/ok"
echo "walking $WALK"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&$WALK" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-page-failure.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-page-failure: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

FAILED_LINE="domicile: a <webview>'s page failed to load ("

# 3. The walk, or in the control the page that loads.
wait_for_line "$TRIES" "GUARD ok-loaded" "$ENGINE_LOG" ||
  echo "the last page never loaded" >&2
# A settle for the last report, which follows the load.
sleep 3

saw() { # $1 pattern, $2 file
  grep -qF "$1" "${2:-$ENGINE_LOG}" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_LOADED=$(saw "GUARD ok-loaded")
SAW_ASKED=$(saw "asked-for " "$HTTP_LOG")
SAW_REPORTED=$(saw "$FAILED_LINE")
SAW_HTTP=$(saw "GUARD failure kind=http error=ERR_HTTP_RESPONSE_CODE_FAILURE status=500 proceed=false url=$SITE/empty-500")
SAW_NETWORK=$(saw "GUARD failure kind=network error=ERR_EMPTY_RESPONSE status=0 proceed=false url=$SITE/drop")
SAW_CLEARED=$(saw "GUARD failure kind= error= status=0 proceed=false url=")
SAW_ANY=$( (grep -qF "GUARD failure kind=" "$ENGINE_LOG" ||
  grep -qF "$FAILED_LINE" "$ENGINE_LOG") && echo 1 || echo 0)

echo
echo "shell=$SAW_SHELL asked=$SAW_ASKED loaded=$SAW_LOADED"
echo "failure: reported=$SAW_REPORTED http=$SAW_HTTP network=$SAW_NETWORK cleared=$SAW_CLEARED any=$SAW_ANY"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `packages/domicile-engine/tests/test-webview-page-failure-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up. This is the \
harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="the server was never asked for a page. That is the guest: it was \
not made, attached or navigated"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_LOADED" != "1" ]; then
    FAILURE="the page never loaded in the window, so the control measured \
nothing. That is the guest"
  elif [ "$SAW_ANY" = "1" ]; then
    FAILURE="the control loaded a page that works and a failure was reported \
anyway, so the positive run's reports may come from the load rather than \
the failure"
  else
    PASSED="the control is sharp: a page that loads reported no failure"
  fi
elif [ "$SAW_REPORTED" != "1" ]; then
  FAILURE="the pages failed and the browser never reported it. \
WebViewGuest::DidFinishNavigation did not see an error page commit, or its \
posted ReportPageFailure never ran"
elif [ "$SAW_HTTP" != "1" ]; then
  FAILURE="the browser reported a failure and the shell never heard the HTTP \
error as http with status 500. PageFailureChanged did not reach the element, \
or ReportPageFailure did not read the status from the response headers"
elif [ "$SAW_NETWORK" != "1" ]; then
  FAILURE="the shell heard the HTTP error and never the network one as \
network with ERR_EMPTY_RESPONSE. ReportPageFailure named it wrong, or \
skipped it as unchanged"
elif [ "$SAW_CLEARED" != "1" ]; then
  FAILURE="the failures were reported and a page that loaded never cleared \
them. DidFinishNavigation did not report null for a page that is not an \
error page"
else
  PASSED="each failed page was reported to the shell as what it was, in \
place of Chrome's error pages, and the page that loaded cleared it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-page-failure: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the server said:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
