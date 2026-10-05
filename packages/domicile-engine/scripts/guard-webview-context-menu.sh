#!/usr/bin/env bash
# Checks a right click in a browser window: the shell gets the menu, and its
# "inspect" opens DevTools in a new window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-context-menu.sh /build/chromium/src
#
# Headless and software-composited, like guard-webview-routed-link.sh.
#
# The browser draws no context menu (patch 0047). `WebViewGuest::
# HandleContextMenu` sends the menu's contents to the element, which fires
# `domicile-context-menu`. This guard runs "inspect" from that menu because it
# crosses every layer: the guest opens a browser window at DevTools' address,
# the shell draws it, and //chrome attaches DevTools to it.
#
# Assertions, in order (each depends on the one before):
# - the shell page ran
# - a press reached the shell's document (the harness can click at all)
# - a page loaded in the window
# - the press reached the page: its `contextmenu` fired
# - the shell got the menu, with the link and picture under the click
# - "inspect" opened a browser window at devtools://
# - the browser logged DevTools attached in the new window
#
# Control (NEGATIVE=1): the page cancels its own `contextmenu`, as a site with
# its own menu does. The page must hear the press and the shell nothing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-context-menu: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 serves the page that cancels its own menu. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-context-menu-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-context-menu-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Not `STRIP`, which is a program inside `nix develop .#full`: see
# guard-webview-routed-link.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's page, which is one full-bleed picture in one
# full-bleed link. The same point in the run and its control.
WINDOW_X=$((WIDTH / 2))
PAGE_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

FOR_SECONDS="${FOR_SECONDS:-90}"

WHICH=""
QUERY=""
if [ "$NEGATIVE" = "1" ]; then
  WHICH="-negative"
  QUERY="?refuse"
fi
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-context-menu$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-context-menu$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-context-menu$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-context-menu: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-context-menu: no python3, and the pages in the window and the click are both driven by one"
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

# 1. The pages.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-context-menu-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-context-menu: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-context-menu: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a picture in a link at $SITE/page$QUERY"

# 2. The engine, on a domicile:// document. The page's address goes in the
#    shell's query, so the control's `?refuse` is escaped there.
rm -f "$ENGINE_LOG"
SRC="$SITE/page"
[ "$NEGATIVE" = "1" ] && SRC="$SITE/page%3Frefuse"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SRC" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-context-menu.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-context-menu: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-context-menu: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. A page in the window, and its first frame at the browser: a press is
#    routed by hit test.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep 3

# 4. A press on the shell's own strip, which this document must report.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2
wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. The right click, on the picture in the link.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$PAGE_Y" --button right \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# Long enough for the whole path: the menu, "inspect", the window, DevTools'
# front end loading and attaching. A fixed wait, because the control's
# readings are absences.
sleep 15

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_PRESS=$(saw "GUARD page-contextmenu")
# The menu, with the link and the picture under the click: an event about some
# other page cannot pass.
SAW_MENU=$(saw "GUARD context-menu link=$SITE/opened src=$SITE/picture.png media=image pixels=true")
SAW_ASKED=$(saw "GUARD new-window url=devtools://devtools/bundled/devtools_app.html")
# The browser's own line, from domicile_devtools.cc: a page could not write it.
SAW_ATTACHED=$(saw "domicile: DevTools is attached in a <webview>.")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the shell's document saw: press=$SAW_CHROME menu=$SAW_MENU asked=$SAW_ASKED"
echo "the page in the window saw: contextmenu=$SAW_PRESS"
echo "the browser process said: attached=$SAW_ATTACHED"
echo

# Decided here, in a block `scripts/test-webview-context-menu-guard.sh` runs
# directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so every reading \
below is about a desktop nobody touched. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no link under the \
press. That is the guest: it was not made, not attached, or not navigated"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the right click never reached the page in the window: its \
contextmenu never fired. That is this harness -- the button, or the press \
point -- rather than the menu"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_MENU" = "1" ]; then
    FAILURE="the control's page canceled its own contextmenu and the shell \
was handed a menu anyway: the browser hands over menus a site asked to keep, \
so a site's own menu would open under the shell's"
  else
    PASSED="the control is sharp: a page that cancels its own contextmenu \
heard the right click and the shell was handed nothing"
  fi
elif [ "$SAW_MENU" != "1" ]; then
  FAILURE="the shell got no menu, or one without the link and the \
picture under the click. The page heard the right click and left it alone, so \
this is WebViewGuest::HandleContextMenu, ContextMenuRequested or the \
element's domicile-context-menu event"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="the menu's \"inspect\" opened no window: run() on the event, \
RunContextMenuAction or OpenDevTools in domicile_devtools.cc. The engine log \
says whether the action reached the browser"
elif [ "$SAW_ATTACHED" != "1" ]; then
  FAILURE="DevTools' window opened but nothing attached to it: a browser \
window loaded devtools:// and the browser never bound it to the page. \
That is DevToolsFrontendWatcher in domicile_devtools.cc -- the front end \
never committed in the guest, or DevToolsUI made no bindings for it"
else
  PASSED="a right click in a browser window handed the shell a menu with the \
link and the picture under it, and its \"inspect\" opened DevTools for the \
page in a window the shell drew"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-context-menu: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
