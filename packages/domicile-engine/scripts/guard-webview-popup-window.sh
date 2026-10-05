#!/usr/bin/env bash
# An extension's windows.create({type: "popup"}) opened by the shell as a
# window of its own, whose page is that window's tab -- and whose
# windows.remove the shell hears.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-popup-window.sh /build/chromium/src
#
# WHY THIS EXISTS. Bitwarden's sign-in from its autofill menu is a popup window
# of its own, opened with windows.create and closed with windows.remove once
# signed in. A desk refused both, so the button did nothing. The desk now makes
# the window, asks the shell for its tab as `domicile-popup-window`, and takes
# the <webview> that names it in `popupwindow` as that tab. EXTENSIONS.md.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`. The shell opens one browser window and
# focuses it, then opens the fixture's popup in a <webview> never focused. The
# popup asks for a popup window; the shell opens a <webview> at the address the
# event carries, naming the window. The window's page writes what
# windows.getCurrent and tabs.query({windowType: "popup"}) say into its own
# address, then removes its window.
#
# WHAT IT ASSERTS. That the shell was asked, at the size the fixture asked for;
# that the page's window is a `popup`, and the one the event named; that
# tabs.query finds it; that the shell heard its windows.remove as
# `domicile-close`; and that windows.create answered with the window.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same run, and the shell
# opens the same <webview> WITHOUT `popupwindow`. Its page must be in the
# desk's own window (`normal`), find no popup window's tab, be refused the
# remove -- the desk's window is the desktop -- and windows.create must not
# answer. That is what makes the claim's window the attribute's: a desk that
# made every page a popup window, or none, answers the same both times.
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
  annotate "guard-webview-popup-window: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture, as the tray must name it, and the size its popup asks for.
# Fixed rather than overridable: `scripts/test-webview-popup-window-guard.sh`
# holds the id to the manifest's `key` and the size to popup.js.
readonly ID="eeakegpaijmndccnpjplchoonieggcfo"
readonly POPUP="chrome-extension://$ID/popup.html"
readonly WINDOW="chrome-extension://$ID/window.html"
readonly WIDTH="420"
readonly HEIGHT="360"

EXTENSION="$SCRIPTS/guard-webview-popup-window-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-popup-window-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-popup-window-control}"
PROFILE="${PROFILE:-/tmp/domicile-webview-popup-window-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-popup-window-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-webview-popup-window-socket.log}"
# One per leg, as guard-webview-tabs.sh's.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-popup-window-http-$NEGATIVE.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-popup-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-popup-window: no python3, and the compositor's end of the socket and the window's page are served by one"
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

# 1. The browser window's page.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color 25A8F9 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-popup-window: the window's page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-popup-window: the window's page server never said which port it took" "$HTTP_LOG"
  exit 1
}
A="http://127.0.0.1:$PORT/page?a"

# The claim names the window on its <webview>; the control does not.
if [ "$NEGATIVE" = "1" ]; then
  NAME=0
  LEG=control
else
  NAME=1
  LEG=popup
fi

# 2. The compositor's end, naming the fixture in both legs.
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --unpacked "$EXTENSION" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-webview-popup-window: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine.
STARTED_AT="$(date +%s)"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&name=$NAME&a=$A" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-popup-window.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" '"GUARD listening"' "$ENGINE_LOG" ||
  echo "the shell module never said it was listening; the verdict below says what that means" >&2

# 4. The wait. Both legs end on the window's page saying where it is; the
#    claim then on windows.create's answer, which comes once the window has
#    its tab. The control's is bounded by what the claim's took.
if [ "$NEGATIVE" = "1" ]; then
  wait_for_line "$(($(budget_for webview-popup-window "$FOR_SECONDS") * 4))" \
    '"GUARD window current=' "$ENGINE_LOG"
else
  if wait_for_line "$TRIES" '"GUARD window current=' "$ENGINE_LOG"; then
    budget_note webview-popup-window "$(($(date +%s) - STARTED_AT))"
  fi
  wait_for_line 20 '"GUARD created id=' "$ENGINE_LOG"
fi

# The remove reaches the window's element over its own pipe, after the page
# said where it is. Bounded: the page has already answered. The control waits
# the same, for a close and an answer that must not come.
wait_for_line 20 '"GUARD window closed"' "$ENGINE_LOG"
sleep 1

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-windows-state.sh for why.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}

# The id the engine asked for the window under, as the shell heard it.
NAMED="$(sed -n 's/.*"GUARD asked id=\([0-9]*\) .*/\1/p' "$ENGINE_LOG" | head -1)"

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
TRAY=$(saw "\"GUARD tray popup=$POPUP\"")
SHOWN=$(saw "\"GUARD page url=$A\"")
ASKED=0
[ -n "$NAMED" ] && ASKED=1
SIZED=$(saw "width=$WIDTH height=$HEIGHT\"")
TYPED=$(saw ' type=popup ')
SAME=0
[ -n "$NAMED" ] && SAME=$(saw "\"GUARD window current=$NAMED type=")
FOUND=$(saw ' found=1 ')
CLOSED=$(saw '"GUARD window closed"')
CREATED=0
[ -n "$NAMED" ] && CREATED=$(saw "\"GUARD created id=$NAMED tabs=1\"")

MEASURED="$LEG $SENT $TRAY $SHOWN $ASKED $SIZED $TYPED $SAME $FOUND $CLOSED \
$CREATED"
echo
echo "measured: $MEASURED"
echo "what the shell was asked, and what the window's page heard:"
grep -F -e '"GUARD asked ' -e '"GUARD window ' -e '"GUARD created ' \
  "$ENGINE_LOG" | tail -6 || true

# WHICH END TO BLAME. `scripts/test-webview-popup-window-guard.sh` runs this
# block directly. MEASURED is "<leg> <sent> <tray> <shown> <asked> <sized>
# <typed> <same> <found> <closed> <created>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"popup 1 1 1 1 1 1 1 1 1 1")
  PASSED="the shell was asked for the popup window at the size the fixture \
asked for, the <webview> naming it was its tab -- a popup window tabs.query \
finds -- its windows.remove reached the shell as domicile-close, and \
windows.create answered with it"
  ;;
"control 1 1 1 1 1 0 0 0 0 0")
  PASSED="the control is sharp: the same <webview> opened without \
popupwindow was a tab of the desk's own window, found no popup window, was \
refused the remove, and windows.create never answered -- so the claim's window \
is the attribute's"
  ;;
"popup 0 "* | "control 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind and nothing \
was installed"
  ;;
"popup 1 0 "* | "control 1 0 "*)
  FAILURE="the shell never heard the fixture's popup in the tray, so it \
had nothing to open: the installer, or ExtensionTray"
  ;;
"popup 1 1 0 "* | "control 1 1 0 "*)
  FAILURE="the browser window never showed its page, so nothing was focused \
and there was no active tab to ask through. The guest, or the page server"
  ;;
"popup 1 1 1 0 "* | "control 1 1 1 0 "*)
  FAILURE="the shell was never asked for the window: the popup's \
windows.create was refused or asked no element -- the engine log says which \
(kNotOnADesk, no active tab), or WebViewGuestClient.PopupWindowRequested \
never became domicile-popup-window"
  ;;
"popup 1 1 1 1 0 "* | "control 1 1 1 1 0 "*)
  FAILURE="the shell was asked for the window at a size other than the \
fixture's: windows.create's width and height were not the ones carried"
  ;;
"popup 1 1 1 1 1 0 "*)
  FAILURE="the shell opened the <webview> naming the window and its page was \
not in a popup window: the element did not carry popupwindow in CreateGuest, \
or the desk did not take it as the window's tab (AddToDesk)"
  ;;
"popup 1 1 1 1 1 1 0 "*)
  FAILURE="the page is in a popup window, but not the one the shell was \
asked for: the window the element named is not the window it joined"
  ;;
"popup 1 1 1 1 1 1 1 0 "*)
  FAILURE="the page is in its popup window and tabs.query({windowType: \
\"popup\"}) did not find it: the desk's tabs.query walks the desk's window only"
  ;;
"popup 1 1 1 1 1 1 1 1 0 "*)
  FAILURE="the page removed its window and the shell never heard it: \
windows.remove did not ask the window's tab to close (domicile-close)"
  ;;
"popup 1 1 1 1 1 1 1 1 1 0")
  FAILURE="the window was opened, found and removed, and windows.create \
never answered with it: the popup window's tab did not answer WhenNextTab"
  ;;
"control 1 1 1 1 1 1 "*)
  FAILURE="the control's <webview>, opened without popupwindow, was a popup \
window anyway: the desk makes the window some way other than the attribute, \
so the claim's pass was not the attribute's"
  ;;
"control 1 1 1 1 1 0 0 0 1 "*)
  FAILURE="the control's page removed the desk's own window and the shell \
heard it close: windows.remove must refuse the desk"
  ;;
"control 1 1 1 1 1 0 "*)
  FAILURE="the control's page was in the desk's window and still found a \
popup window's tab, or windows.create answered with no tab in its window"
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

annotate_from "guard-webview-popup-window: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
