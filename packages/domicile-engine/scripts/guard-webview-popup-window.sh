#!/usr/bin/env bash
# An extension's windows.create({type: "popup"}) opens a desk browser window
# as that popup window's tab, and its windows.remove closes it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-popup-window.sh /build/chromium/src
#
# Why: Bitwarden's sign-in from its autofill menu is a popup window, opened
# with windows.create and closed with windows.remove once signed in. The desk
# makes the window and opens a browser window as its tab. The shell gets it in
# `browserwindowschanged`, with the popup window and its size, and draws it
# with `<webview window>`. See EXTENSIONS.md and
# src/components/domicile/mojom/browser_windows.mojom.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`. The shell opens one browser window and
# focuses it, then opens the fixture's popup in a <webview> never focused. The
# popup asks for a popup window, the engine opens a browser window for it, and
# the shell draws that window. The window's page writes what
# windows.getCurrent and tabs.query({windowType: "popup"}) say into its own
# address, then removes its window.
#
# It asserts:
# - a window for the popup window reached the shell, at the requested size
# - the page's window is a `popup`, and the one the list named
# - tabs.query finds it
# - its windows.remove took it out of the list
# - windows.create answered with the window
#
# Control: NEGATIVE=1 leaves the engine's window undrawn and opens the shell's
# own window at the same page. Its page must be in the desk's own window
# (`normal`) and be refused the remove, since the desk's window is the
# desktop, so its window stays. A desk that made every page a popup window, or
# none, would answer the same in both runs. The control skips the tabs.query
# reading: the engine's popup window stays open until its page removes it,
# which races the control's read.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
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

# 4. The wait. Both legs end when the window's page reports its window, then
#    on windows.create's answer, which comes once the window has its tab. The
#    claim's duration bounds the control's.
if [ "$NEGATIVE" = "1" ]; then
  wait_for_line "$(($(budget_for webview-popup-window "$FOR_SECONDS") * 4))" \
    '"GUARD window current=' "$ENGINE_LOG"
else
  if wait_for_line "$TRIES" '"GUARD window current=' "$ENGINE_LOG"; then
    budget_note webview-popup-window "$(($(date +%s) - STARTED_AT))"
  fi
fi
wait_for_line 20 '"GUARD created id=' "$ENGINE_LOG"

# The remove reaches the list after the page reports. Bounded, since the page
# has already answered. The control waits as long for a close that must not
# come.
wait_for_line 20 '"GUARD window closed"' "$ENGINE_LOG"
sleep 1

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-control-arrival.sh for the run that learned why.
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
# Not read in the control: see the header.
[ "$NEGATIVE" = "1" ] && FOUND=0
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
  PASSED="a browser window for the popup window reached the shell at the \
size the fixture asked for, its page was the popup window's tab -- a popup \
window tabs.query finds -- its windows.remove closed it, and windows.create \
answered with it"
  ;;
"control 1 1 1 1 1 0 0 0 0 1")
  PASSED="the control is sharp: the same page in a browser window the shell \
opened itself was a tab of the desk's own window and was refused the remove \
-- so the claim's window is the popup window's, not the page's"
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
  FAILURE="no window for the popup window reached the shell: the popup's \
windows.create was refused or had no tab to ask through -- the engine log says \
which (kNotOnADesk, no active tab) -- or WebViewGuest::RequestPopupWindow \
opened no browser window ('opened browser window' in the log), or the list \
never carried it"
  ;;
"popup 1 1 1 1 0 "* | "control 1 1 1 1 0 "*)
  FAILURE="the window reached the shell at a size other than the \
fixture's: windows.create's width and height were not the ones carried"
  ;;
"popup 1 1 1 1 1 0 "*)
  FAILURE="the shell drew the window opened for the popup window and its \
page was not in a popup window: OpenPopupWindow did not carry the popup \
window's id to the guest, or the desk did not take it as the window's tab \
(AddToDesk)"
  ;;
"popup 1 1 1 1 1 1 0 "*)
  FAILURE="the page is in a popup window, but not the one the list named: \
the window its browser window was opened for is not the window it joined"
  ;;
"popup 1 1 1 1 1 1 1 0 "*)
  FAILURE="the page is in its popup window and tabs.query({windowType: \
\"popup\"}) did not find it: the desk's tabs.query walks the desk's window only"
  ;;
"popup 1 1 1 1 1 1 1 1 0 "*)
  FAILURE="the page removed its window and its browser window stayed in the \
list: windows.remove did not close the window's tab (BrowserWindowHost::Close)"
  ;;
"popup 1 1 1 1 1 1 1 1 1 0")
  FAILURE="the window was opened, found and removed, and windows.create \
never answered with it: the popup window's tab did not answer WhenNextTab"
  ;;
"control 1 1 1 1 1 1 "*)
  FAILURE="the control's window, opened by the shell without any popup \
window, was a popup window's tab anyway: the desk makes a page a popup window's \
tab some way other than the window it was opened for, so the claim's pass was \
not the popup window's"
  ;;
"control 1 1 1 1 1 0 0 0 1 "*)
  FAILURE="the control's page removed the desk's own window and the shell \
heard it close: windows.remove must refuse the desk"
  ;;
"control 1 1 1 1 1 0 0 0 0 0")
  FAILURE="the control's page was in the desk's window, but windows.create \
never answered: the popup window's tab did not answer WhenNextTab, for a \
window the engine opened whether or not the shell drew it"""
  ;;
"control 1 1 1 1 1 0 "*)
  FAILURE="the control's page was in the desk's window and is not the window \
it says: a reading this guard cannot place ($MEASURED)"
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
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
