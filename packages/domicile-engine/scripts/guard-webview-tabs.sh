#!/usr/bin/env bash
# An extension's popup asking tabs.query for the active tab, and hearing the
# <webview> the shell focused.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-tabs.sh /build/chromium/src
#
# WHY THIS EXISTS. EXTENSIONS.md's slice 2 is every <webview> a tab to
# chrome.tabs, and the one question nearly every popup opens with is
# `tabs.query({active: true, currentWindow: true})`. Before the desk, that found
# nothing: Chrome looks for tabs in browser windows' tab strips, and a guest is
# in none. What makes it answer is the desk's window controller, the lookups'
# hooks (patch 0057) and the element telling the browser it took focus.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`. The shell opens two browser windows at two
# addresses on one page server, focuses one with `view.focus()`, and then opens
# the fixture's popup -- in a third <webview>, never focused -- which writes its
# answer into its own address.
#
# WHAT IT ASSERTS. That the popup's answer is the address of window `a`, the
# one the shell focused.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same run, focusing window
# `b` instead. The answer must be `b`'s and NOT `a`'s. That is what makes the
# claim's reading focus's: a desk whose active tab were the first window made
# names `a` both times, and one whose active tab were the last made names the
# popup's own window, or `b`, in the claim.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-tabs: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture, as the tray must name it. Fixed rather than overridable:
# `scripts/test-webview-tabs-guard.sh` holds the id to the manifest's `key`.
readonly ID="almpdkloglkdomnhghbmejhddjoajijj"
readonly POPUP="chrome-extension://$ID/popup.html"

EXTENSION="$SCRIPTS/guard-webview-tabs-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-tabs-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-tabs-control}"
PROFILE="${PROFILE:-/tmp/domicile-webview-tabs-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-tabs-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-webview-tabs-socket.log}"
# One per leg, as guard-extension-tray.sh's: the control runs straight after
# the claim, and a server still answering the claim's engine as it died wrote
# into the control's log.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-tabs-http-$NEGATIVE.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    # Reaped, so nothing this started outlives the leg -- and a server still
    # answering cannot write into the next leg's files.
    wait "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-tabs: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-tabs: no python3, and the compositor's end of the socket and the windows' page are served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$BROKER" "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The two windows' page: one server, one page, two addresses. The server
#    answers `/page` whatever its query, and the query is what tells the two
#    windows -- and so the popup's answer -- apart.
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color 25A8F9 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-tabs: the windows' page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-tabs: the windows' page server never said which port it took" "$HTTP_LOG"
  exit 1
}
A="http://127.0.0.1:$PORT/page?a"
B="http://127.0.0.1:$PORT/page?b"

# The claim focuses `a`; the control, `b`.
if [ "$NEGATIVE" = "1" ]; then
  FOCUS=b
  LEG=control
else
  FOCUS=a
  LEG=tabs
fi

# 2. The compositor's end, naming the fixture in both legs: the control's
#    difference is the focus and nothing else.
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --unpacked "$EXTENSION" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-webview-tabs: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine. The addresses go into the shell's query as they are: the
#    first `?` of a URL is the one that starts its query, so `a=…/page?a` is a
#    value with a `?` in it.
STARTED_AT="$(date +%s)"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&focus=$FOCUS&a=$A&b=$B" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-tabs.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" '"GUARD listening"' "$ENGINE_LOG" ||
  echo "the shell module never said it was listening; the verdict below says what that means" >&2

# 4. The wait: both legs end on the popup's answer. The control's is bounded
#    by what the claim's took, which is the same run with the other window
#    focused.
if [ "$NEGATIVE" = "1" ]; then
  wait_for_line "$(($(budget_for webview-tabs "$FOR_SECONDS") * 4))" \
    '"GUARD answer active=' "$ENGINE_LOG"
else
  if wait_for_line "$TRIES" '"GUARD answer active=' "$ENGINE_LOG"; then
    budget_note webview-tabs "$(($(date +%s) - STARTED_AT))"
  fi
fi

# A moment for anything already dispatched to be written out.
sleep 1

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-control-arrival.sh for the run that learned why.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
TRAY=$(saw "\"GUARD tray popup=$POPUP\"")
SHOWN=0
if [ "$(saw "\"GUARD page name=a url=$A\"")" = 1 ] &&
  [ "$(saw "\"GUARD page name=b url=$B\"")" = 1 ]; then
  SHOWN=1
fi
FOCUSED=$(saw "\"GUARD focused name=$FOCUS\"")
ANSWERED=$(saw '"GUARD answer active=')
NAMED_A=$(saw "\"GUARD answer active=$A\"")
NAMED_B=$(saw "\"GUARD answer active=$B\"")

MEASURED="$LEG $SENT $TRAY $SHOWN $FOCUSED $ANSWERED $NAMED_A $NAMED_B"
echo
echo "measured: $MEASURED"
echo "what the popup answered:"
grep -F '"GUARD answer ' "$ENGINE_LOG" | tail -3 || true

# WHICH END TO BLAME. `scripts/test-webview-tabs-guard.sh` runs this block
# directly. MEASURED is "<leg> <sent> <tray> <shown> <focused> <answered>
# <named-a> <named-b>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"tabs 1 1 1 1 1 1 0")
  PASSED="the popup's tabs.query({active: true, currentWindow: true}) named \
the <webview> the shell focused"
  ;;
"control 1 1 1 1 1 0 1")
  PASSED="the control is sharp: with the other window focused, the same \
popup named that one and not the claim's -- so the claim's answer is focus's, \
not the first window's or the last's"
  ;;
"tabs 0 "* | "control 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind and nothing \
was installed"
  ;;
"tabs 1 0 "* | "control 1 0 "*)
  FAILURE="the shell never heard the fixture's popup in the tray, so it \
had nothing to open: the installer, or ExtensionTray"
  ;;
"tabs 1 1 0 "* | "control 1 1 0 "*)
  FAILURE="the two windows never both showed their pages, so nothing was \
focused and the answer is not a reading. The guests, or the page server"
  ;;
"tabs 1 1 1 0 "* | "control 1 1 1 0 "*)
  FAILURE="the shell never focused its window, so there was no active tab \
to name. The shell module"
  ;;
"tabs 1 1 1 1 0 "* | "control 1 1 1 1 0 "*)
  FAILURE="the popup opened and never answered: its tabs.query did not \
return, or its page did not reach the <webview>. The desk's tabs.query, or \
the popup's navigation"
  ;;
"tabs 1 1 1 1 1 0 0" | "control 1 1 1 1 1 0 0")
  FAILURE="the popup answered, naming neither window -- the GUARD answer \
line above says what: count-0 is a desk with no active tab, so the element's \
focus never reached the browser (WebViewGuest::Focused) or the lookups do not \
find a guest; an error is the function refusing"
  ;;
"tabs 1 1 1 1 1 0 1")
  FAILURE="the popup named window b with window a focused: the active tab \
does not follow focus -- the last window made, or the focus the element \
reported was not a"
  ;;
"control 1 1 1 1 1 1 0")
  FAILURE="the control named window a with window b focused: the active tab \
is the first made, not the focused one, so the claim's pass was an accident \
of order"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the run did \
not get as far as reading, or ran a leg this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-tabs: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
