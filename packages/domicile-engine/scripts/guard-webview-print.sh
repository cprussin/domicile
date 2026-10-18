#!/usr/bin/env bash
# A browser window's page prints through the system print dialog: the shell's
# `print()`, and then the page's own `window.print()`.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-print.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-beforeunload.sh:
# nothing here is measured in pixels.
#
# `print()` reaches WebViewGuest::Print, which runs domicile::PrintPage:
# Chrome's StartBasicPrint on the guest, answered by the PrintViewManager
# domicile::AttachPrinting gives every guest. The page's `beforeprint` and
# `afterprint` bracket the print. The page then calls `window.print()`, which
# reaches the same dialog only with Print Preview off
# (domicile::PrintWithTheSystemDialog). A unit test cannot check this: happy-dom
# has no guest and no renderer to print.
#
# The engine runs on a session bus nothing listens on, so no portal answers and
# the dialog fails at once. A dialog on the machine's own bus could wait for a
# person forever.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   there is a page in the window    a guest was made, attached and navigated
#   nothing dumped a signal          Print Preview on a guest crashes
#   the shell asked to print         the page finished loading
#   the browser printed              WebViewGuest::Print ran PrintPage
#   the page started printing        a PrintViewManager answered
#   the page finished printing       the dialog was answered
#   the page printed itself          window.print() started
#   that print finished too          it went to the dialog, not to a preview
#
# NEGATIVE=1 is the control: the shell never calls `print()`. The page must see
# no print, or the run's prints could come from something other than
# `print()`.
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

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-print: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-print-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-print-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Time for the shell to load and its guest to attach, navigate and print twice.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long the control waits for a print it should never see, after the page
# loads. The run's first print starts a second after the load.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-print$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-print$WHICH-http.log}"

PRINT=1
[ "$NEGATIVE" = "1" ] && PRINT=0

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-print: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-print: no python3, and the page in the window is served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page: one local server, because `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-print-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-print: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-print: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page to print at $SITE/page"

# 2. The engine, on a domicile:// document, because the browser binds
#    BrowserWindows and WebViewGuestHost for that origin only. Its session bus
#    is a socket nothing listens on: see the header.
rm -f "$ENGINE_LOG"
DBUS_SESSION_BUS_ADDRESS="unix:path=$PROFILE/no-bus" \
  "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?print=$PRINT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-print.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-print: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}

# 3. The page, then both prints, or in the control a wait for a print that must
#    not come.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
if [ "$NEGATIVE" = "1" ]; then
  sleep "$SETTLE_SECONDS"
else
  wait_for_line "$TRIES" "GUARD page-afterprint 2" "$ENGINE_LOG" ||
    echo "the page never finished its second print" >&2
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_CRASH=$(saw "Received signal")
SAW_ASKED=$(saw "GUARD printing")
SAW_PRINTED=$(saw "domicile: printing a <webview>'s page with the system dialog.")
SAW_BEFORE=$(saw "GUARD page-beforeprint 1")
SAW_AFTER=$(saw "GUARD page-afterprint 1")
SAW_OWN_BEFORE=$(saw "GUARD page-beforeprint 2")
SAW_OWN_AFTER=$(saw "GUARD page-afterprint 2")
SAW_ANY=$(saw "GUARD page-beforeprint")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE crash=$SAW_CRASH"
echo "print(): asked=$SAW_ASKED printed=$SAW_PRINTED before=$SAW_BEFORE after=$SAW_AFTER"
echo "window.print(): before=$SAW_OWN_BEFORE after=$SAW_OWN_AFTER any=$SAW_ANY"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `scripts/test-webview-print-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up. This is the \
harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing loaded in the window, so there was no page to print. That \
is the guest: it was not made, attached or navigated"
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. A print on a guest crashes when it \
reaches Print Preview, which has no tab to show in"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY" = "1" ]; then
    FAILURE="the control's shell never called print() and the page printed \
anyway, so the run's prints may not be print()'s"
  else
    PASSED="the control is sharp: with no print() the page never printed"
  fi
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="the shell never called print(). The page never finished loading, \
or domicile-loading-change did not say so"
elif [ "$SAW_PRINTED" != "1" ]; then
  FAILURE="the shell called print() and the browser never printed. The \
element dropped it, or WebViewGuest::Print did not run PrintPage"
elif [ "$SAW_BEFORE" != "1" ]; then
  FAILURE="the browser printed and the page never started. No \
PrintViewManager answered: AttachPrinting did not run on this guest"
elif [ "$SAW_AFTER" != "1" ]; then
  FAILURE="the page started printing and never finished. The system dialog \
was never answered, so the page is stuck in print"
elif [ "$SAW_OWN_BEFORE" != "1" ]; then
  FAILURE="the page's own window.print() never started. The renderer \
throttled or refused it"
elif [ "$SAW_OWN_AFTER" != "1" ]; then
  FAILURE="the page's own window.print() never finished. Print Preview is on, \
so the page asked for a preview the engine cannot show: \
PrintWithTheSystemDialog did not turn it off"
else
  PASSED="print() and the page's window.print() both went through the system \
dialog"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-print: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
