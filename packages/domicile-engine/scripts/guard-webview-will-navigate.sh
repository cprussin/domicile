#!/usr/bin/env bash
# Checks a <webview>'s `domicile-will-navigate` asks the shell before the page
# navigates itself, and that `preventDefault()` keeps the page where it is.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-will-navigate.sh /build/chromium/src
#
# Headless and software-composited: nothing is measured in pixels.
#
# WillNavigateThrottle defers a renderer-initiated main-frame navigation in a
# guest and asks the element (WebViewGuest::AskToNavigate). The page sets
# `location` to /blocked, which the shell cancels, then to /allowed, which it
# lets through. The shell then sets `src` itself, which must not ask.
#
# Asserts, in order (each only meaningful if the previous holds):
#
#   the shell ran and /start was served    the page was there to navigate
#   the element asked about /blocked       the event fires
#   /blocked was never requested           the cancel stopped the request
#   the element asked about /allowed and   an event not canceled lets the
#   it was served                          navigation go ahead
#   /shell-set was served, and nothing     the shell's own navigation does not
#   asked about it or /start               ask
#
# NEGATIVE=1 cancels nothing. /blocked must be served, so a run where the page
# never navigates, or the request is never logged, cannot pass.
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
  annotate "guard-webview-will-navigate: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 cancels nothing. See the header.
NEGATIVE="${NEGATIVE:-0}"
CANCEL=1
[ "$NEGATIVE" = "1" ] && CANCEL=0

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-will-navigate-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-will-navigate-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Time for the shell to load, make its guest and walk the page through its
# navigations. Generous because the machine is shared.
FOR_SECONDS="${FOR_SECONDS:-60}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-will-navigate$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-will-navigate$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-will-navigate: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-will-navigate: no python3, and the pages are served by one"
  exit 77
}

rm -rf "$PROFILE"
mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-will-navigate-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-will-navigate: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-will-navigate: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving at $SITE, cancel=$CANCEL"

# 2. The engine, on a domicile:// document, because the browser binds
# WebViewGuestHost only for that origin.
fresh_broker
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?site=$SITE&cancel=$CANCEL" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-will-navigate.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qE "GUARD done|Received signal" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

saw() { # $1 pattern, $2 log
  grep -qF "$1" "$2" 2>/dev/null && echo 1 || echo 0
}
# Each path the element asked about, in order, space-separated.
ASKED="$(sed -n 's/^.*GUARD will-navigate path=\([^ "]*\).*$/\1/p' "$ENGINE_LOG" | tr '\n' ' ' | sed 's/ $//')"

SAW_SHELL=$(saw "GUARD shell-loaded" "$ENGINE_LOG")
SAW_CRASH=$(saw "Received signal" "$ENGINE_LOG")
SAW_DONE=$(saw "GUARD done" "$ENGINE_LOG")
SERVED_START=$(saw '"GET /start' "$HTTP_LOG")
SERVED_BLOCKED=$(saw '"GET /blocked' "$HTTP_LOG")
SERVED_ALLOWED=$(saw '"GET /allowed' "$HTTP_LOG")
SERVED_SHELL_SET=$(saw '"GET /shell-set' "$HTTP_LOG")
# WebViewGuest's and WillNavigateThrottle's own lines. Diagnostic only.
SAW_ASKING=$(saw "asking the shell" "$ENGINE_LOG")
SAW_CANCELED=$(saw "the shell canceled a <webview>'s navigation" "$ENGINE_LOG")

echo
echo "shell=$SAW_SHELL crash=$SAW_CRASH done=$SAW_DONE asking=$SAW_ASKING canceled=$SAW_CANCELED"
echo "asked: $ASKED"
echo "served: start=$SERVED_START blocked=$SERVED_BLOCKED allowed=$SERVED_ALLOWED shell-set=$SERVED_SHELL_SET"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-will-navigate-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
WANT_ASKED="/blocked /allowed"
[ "$NEGATIVE" = "1" ] && WANT_ASKED="/blocked"
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. Suspect WillNavigateThrottle resuming or \
canceling a navigation that is gone first. Read the dumped stack"
elif [ "$SERVED_START" != "1" ]; then
  FAILURE="/start was never requested, so the page that navigates never \
loaded. That is the guest: it was not made, attached, or navigated to \`src\`"
elif [ -z "$ASKED" ]; then
  FAILURE="the element never fired domicile-will-navigate. Check \
WillNavigateThrottle is added (BrowserPageThrottle::MaybeCreateAndAdd), \
AsksBeforeNavigating, and WebViewGuestClient::WillNavigate in \
html_web_view_element.cc"
elif [ "$NEGATIVE" != "1" ] && [ "$SERVED_BLOCKED" = "1" ]; then
  FAILURE="THE CANCEL DID NOT HOLD: the shell called preventDefault() on \
/blocked and it was requested anyway. Check WillNavigateThrottle defers and \
cancels on an answer of false"
elif [ "$NEGATIVE" = "1" ] && [ "$SERVED_BLOCKED" != "1" ]; then
  FAILURE="nothing canceled /blocked and it was never requested, so a missing \
request proves nothing. Check the throttle resumes on an answer of true, and \
that the server logs its requests"
elif [ "$NEGATIVE" != "1" ] && [ "$SERVED_ALLOWED" != "1" ]; then
  FAILURE="the shell let /allowed through and it was never requested, so the \
throttle never resumed. Check the answer reaches WillNavigateThrottle::Answered"
elif [ "$SAW_DONE" != "1" ] || [ "$SERVED_SHELL_SET" != "1" ]; then
  FAILURE="the shell's own \`src\` was never served, so whether it asks was \
not measured. The shell sets it once the page is past /start; see \
guard-webview-will-navigate.js"
elif [ "$ASKED" != "$WANT_ASKED" ]; then
  FAILURE="the element asked about \"$ASKED\", not \"$WANT_ASKED\". Asking \
about /start or /shell-set means the shell's own navigation asks; check \
AsksBeforeNavigating"
elif [ "$NEGATIVE" = "1" ]; then
  PASSED="the control is sharp: with nothing canceled, /blocked was asked \
about and requested"
else
  PASSED="the element asked about both of the page's navigations; the \
canceled one was never requested and the other went ahead; the shell's own \
\`src\` did not ask"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-will-navigate: $FAILURE"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
