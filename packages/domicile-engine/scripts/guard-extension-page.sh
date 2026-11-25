#!/usr/bin/env bash
# An extension's keys and menu item, pressed and clicked in a page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-page.sh /build/chromium/src
#
# WHY THIS EXISTS. guard-extension-commands.sh has the shell run a command
# itself. Here the keys are pressed in a page: the browser must find the
# command in the page's own profile, keep the key from the page, and run the
# command there, unless the shell listens for it
# (WebViewGuest::PreHandleKeyboardEvent, CommandPressed). And the items of a
# page's own context menu need a right click in a page.
#
# Headless, with guard-extension-commands.sh's fixture, whose service worker
# puts what it hears on its badge, and guard-extension-installer.sh's stand-in
# for the compositor, naming the fixture and three browser profiles. The shell
# shows one page in each, side by side. A click focuses a page, and the keys
# go to the page with focus.
#
# WHAT IT ASSERTS. Ctrl+Shift+L, the fixture's and one of Chrome's, in the default profile's page,
# with a shell that does nothing about extensions' keys (and Ctrl+Shift+U asks
# for the action's popup): the command reaches
# that profile's service worker, and the page, which cancels every key, hears
# nothing. The same in the work profile's. In the private profile's page, where
# the fixture is off, the page hears the key. Then the shell listens for
# `extensioncommandpressed` and runs nothing: the key in the default page names
# the command to it, and the command does not run. A right click in the
# default's carries the fixture's page item, and running it reaches its service
# worker. An item run after its page navigated away does nothing.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: no extension. The default
# profile's page must hear the key, no command may run, and the menu must have
# no items.
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
  annotate "guard-extension-page: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture's id. `packages/domicile-engine/tests/test-extension-page-guard.sh`
# holds it, and the keys below, to the commands guard's.
readonly ID="cobncddhpfhclknjbapgflpohofecjhg"
readonly FILL="Ctrl+Shift+L"
readonly ACTION="Ctrl+Shift+U"
readonly ITEM="Page item"

# FILL as a key event.
KEY_EVDEV=38
KEY_CODE="KeyL"
KEY_KEY="L"
KEY_VKEY=76

EXTENSION="$SCRIPTS/guard-extension-commands-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-extension-page$WHICH-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-page$WHICH-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-page$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-page$WHICH-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-page$WHICH-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-extension-page$WHICH-http.log}"
INPUT_LOG="${INPUT_LOG:-/tmp/domicile-extension-page$WHICH-input.log}"
WIDTH="${WIDTH:-1200}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-extension-page: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-page: no python3, which serves the pages and the compositor's end of the socket and drives the input"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

fresh_broker
rm -f "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The pages.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-extension-page-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-extension-page: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-extension-page: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

# 2. The compositor's end, with the profiles and the fixture -- or, for the
#    control, no fixture.
if [ "$NEGATIVE" = "1" ]; then
  NAMED=()
else
  NAMED=(--unpacked "$EXTENSION")
fi
PROFILES="{\"profiles\": [\
{\"id\": \"default\", \"name\": \"Default\", \"color\": \"#0d9488\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"work\", \"name\": \"Work\", \"color\": \"#d97706\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"private\", \"name\": \"Private\", \"color\": \"#a78bfa\", \
\"private\": true, \"extensions\": []}], \
\"default_profile\": \"default\", \"default_private_profile\": \"private\", \
\"sites\": {}}"
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" ${NAMED[@]+"${NAMED[@]}"} \
  --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-page: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 3. The engine. A real window, as guard-extension-tray.sh's.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --ozone-override-screen-size="$WIDTH,$HEIGHT" \
  --window-size="$WIDTH,$HEIGHT" \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&src=http%3A%2F%2F127.0.0.1%3A$PORT%2Fpage" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-page.js" \
  --domicile-control-socket="$CONTROL" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" '"GUARD shell-loaded"' "$ENGINE_LOG" ||
  echo "the shell module never ran; the verdict below says what that means" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-extension-page: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
for at in default work private; do
  wait_for_line "$TRIES" "GUARD page-loaded at=$at" "$HTTP_LOG" ||
    echo "the page in the $at profile never loaded" >&2
done
# The pages' first frames at the browser: a press is routed by hit test.
sleep 3
if [ "$NEGATIVE" != "1" ]; then
  wait_for_line "$TRIES" '"GUARD badge at=default text=ready"' "$ENGINE_LOG" ||
    echo "the fixture's service worker never ran in the default profile" >&2
fi

click() { # $1 the page's column, $2 the button
  python3 "$SCRIPTS/guard-webview-click-mouse.py" --port "$DEBUG_PORT" \
    --x $(((2 * $1 + 1) * WIDTH / 6)) --y $((HEIGHT / 2)) --button "$2" \
    >>"$INPUT_LOG" 2>&1 ||
    echo "a click could not be driven; see $INPUT_LOG" >&2
}
focus() { # $1 the page's column, $2 its profile
  click "$1" left
  wait_for_line 40 "\"GUARD focused at=$2\"" "$ENGINE_LOG" ||
    echo "the page in the $2 profile never took focus" >&2
}
press() { # $1 code, $2 key, $3 evdev, $4 vkey, each FILL's by default
  python3 "$SCRIPTS/guard-webview-keyboard-key.py" --port "$DEBUG_PORT" \
    --code "${1:-$KEY_CODE}" --key "${2:-$KEY_KEY}" \
    --evdev "${3:-$KEY_EVDEV}" --windows-key-code "${4:-$KEY_VKEY}" \
    --ctrl --shift >>"$INPUT_LOG" 2>&1 ||
    echo "a key could not be driven; see $INPUT_LOG" >&2
  # A fixed wait, because some readings are absences.
  sleep 3
}

# 4. The key in each page, and the default's right click, last: its badge
#    follows the command's.
rm -f "$INPUT_LOG"
focus 0 default
press
# ACTION, as a key event.
press KeyU U 22 85
if [ "$NEGATIVE" != "1" ]; then
  focus 1 work
  wait_for_line "$TRIES" '"GUARD badge at=work text=ready"' "$ENGINE_LOG" ||
    echo "the fixture's service worker never ran in the work profile" >&2
  press
  focus 2 private
  press
  click 0 left
  wait_for_line 40 '"GUARD taking commands"' "$ENGINE_LOG" ||
    echo "the shell never listened for commands" >&2
  press
fi
click 0 right
wait_for_line 40 '"GUARD menu at=default' "$ENGINE_LOG" ||
  echo "the shell never got the page's context menu" >&2
sleep 3
if [ "$NEGATIVE" != "1" ]; then
  click 0 right
  wait_for_line 40 '"GUARD ran a stale item"' "$ENGINE_LOG" ||
    echo "the shell never ran the second menu's item" >&2
  sleep 3
fi

# THE READINGS. The shell's are anchored on the quote Chromium puts after a
# console message -- see guard-windows-state.sh for why. The pages' are the
# server's lines, anchored on the line's end.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}
heard() { # $1 the page's profile
  grep -qxF -- "GUARD page-key at=$1 code=$KEY_CODE" "$HTTP_LOG" 2>/dev/null &&
    echo 1 || echo 0
}
loaded() {
  local at
  for at in default work private; do
    grep -qxF -- "GUARD page-loaded at=$at" "$HTTP_LOG" 2>/dev/null || {
      echo 0
      return
    }
  done
  echo 1
}

# How many times the command ran.
ran() {
  grep -cF "domicile: ran command fill of $ID" "$ENGINE_LOG" 2>/dev/null || true
}
# The page the second menu's item was for went, and the item was dropped.
stale() {
  if [ "$(grep -cxF "GUARD page-loaded at=default" "$HTTP_LOG")" = "2" ] &&
    [ "$(grep -cF "domicile: the shell ran a menu item of $ID" "$ENGINE_LOG")" = "1" ] &&
    [ "$(saw "dropping the extension item")" = "1" ]; then
    echo 1
  else
    echo 0
  fi
}

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
if [ "$NEGATIVE" = "1" ]; then
  MEASURED="control $SENT $(loaded) $(heard default) $(ran) $(saw '"GUARD menu at=default items=."')"
else
  MEASURED="page $SENT $(loaded) $(heard default) $(saw '"GUARD badge at=default text=c:fill"') $(heard work) $(saw '"GUARD badge at=work text=c:fill"') $(heard private) $(saw '"GUARD pressed name=fill profile=default"') $(ran) $(saw "\"GUARD menu at=default items=$ITEM.\"") $(saw '"GUARD badge at=default text=m:page:') $(stale) $(saw "\"GUARD popup at=default url=chrome-extension://$ID/popup.html\"")"
fi

echo
echo "measured: $MEASURED"
echo "what the shell said:"
grep -F '"GUARD ' "$ENGINE_LOG" | tail -20 || true
echo "what the pages said:"
grep -F 'GUARD ' "$HTTP_LOG" || true

# WHICH END TO BLAME. `packages/domicile-engine/tests/test-extension-page-guard.sh`
# runs this block directly. MEASURED is "page <sent> <loaded>" then, for the
# default page and the work page, "<heard by the page> <ran>", then "<heard by
# the private page> <named to the listening shell> <times it ran> <menu>
# <clicked> <stale item dropped> <action's key asked for its popup>"; or "control <sent> <loaded> <heard> <times it
# ran> <empty menu>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"page 1 1 0 1 0 1 1 1 2 1 1 1 1")
  PASSED="the fixture's key in a page of each profile ran its command in that \
profile and did not reach the page; a private page without the fixture kept \
the key; a listening shell was given the command in its place; the fixture's \
item in a page's menu ran, and not once its page was gone"
  ;;
"page 0 "* | "control 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so nothing was installed"
  ;;
"page 1 0 "* | "control 1 0 "*)
  FAILURE="a page never loaded, so its key answers nothing. The lines above \
say which profile's"
  ;;
"page 1 1 1 "*)
  FAILURE="THE DEFAULT PAGE GOT THE EXTENSION'S KEY: CommandPressed did not \
find its command, or PreHandleKeyboardEvent did not handle it"
  ;;
"page 1 1 0 0 "*)
  FAILURE="the key in the default page did not reach the fixture's \
commands.onCommand: CommandPressed, AskShellToRunCommand or RunCommandIn. With \
no GUARD focused above, the harness focused no page"
  ;;
"page 1 1 0 1 1 "*)
  FAILURE="the work page got the extension's key: CommandPressed did not look \
in the page's own profile, or the fixture is not in it"
  ;;
"page 1 1 0 1 0 0 "*)
  FAILURE="the command ran in no work profile's service worker: RunCommandIn \
ran the default profile's copy"
  ;;
"page 1 1 0 1 0 1 0 "*)
  FAILURE="the private page never got the key, and no extension there has it: \
CommandPressed takes a key that runs nothing"
  ;;
"page 1 1 0 1 0 1 1 0 "*)
  FAILURE="the shell listened, and the key never named the command to it: \
DomicileHost::CommandPressed, or the tray's"
  ;;
"page 1 1 0 1 0 1 1 1 3 "*)
  FAILURE="the engine ran a command the shell listened for"
  ;;
"page 1 1 0 1 0 1 1 1 2 0 "*)
  FAILURE="the right click's menu did not carry the fixture's page item and \
nothing else: PageMenuOf, or the event's extensionItems"
  ;;
"page 1 1 0 1 0 1 1 1 2 1 0 "*)
  FAILURE="runExtensionItem() did not reach the fixture's \
contextMenus.onClicked: RunContextMenuExtensionItem, or PageMenu::Run"
  ;;
"page 1 1 0 1 0 1 1 1 2 1 1 1 0")
  FAILURE="the action's key in a page did not ask the shell for its popup: \
RunCommandIn's action"
  ;;
"page 1 1 0 1 0 1 1 1 2 1 1 0 "*)
  FAILURE="AN ITEM OF A PAGE THAT IS GONE RAN, or was never run: \
RunContextMenuExtensionItem"
  ;;
"page 1 1 0 1 0 1 1 1 "*)
  FAILURE="the command ran another number of times than the two keys no shell \
took"
  ;;
"control 1 1 1 0 1")
  PASSED="the control is sharp: with no extension the page heard the key, \
no command ran, and the page's menu had no items"
  ;;
"control 1 1 0 "*)
  FAILURE="the control's page never heard the key, so a page that hears \
nothing in the claim answers nothing. With no GUARD focused above, the harness \
focused no page"
  ;;
"control 1 1 1 0 0")
  FAILURE="the control's menu never arrived, or had items of an extension \
that is not installed"
  ;;
"control 1 1 1 "*)
  FAILURE="the control ran a command of an extension that is not installed"
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

annotate_from "guard-extension-page: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "what the input did:" >&2
tail -20 "$INPUT_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
last_words "$ENGINE_LOG" >&2
exit 1
