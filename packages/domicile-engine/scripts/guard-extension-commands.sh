#!/usr/bin/env bash
# An extension's command and its action's menu item, run by the shell.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-commands.sh /build/chromium/src
#
# WHY THIS EXISTS. The shell runs what Chrome's keys and toolbar menu run:
# ExtensionTray's RunCommand, ActionMenu and RunActionMenuItem. Only the
# extension's service worker hears whether they did.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`. Its service worker puts what it hears on
# its badge, which the tray carries back to the shell.
#
# WHAT IT ASSERTS. That the shell heard `extensioncommandschanged` with the
# fixture's keys; that runExtensionCommand() reached `commands.onCommand`; that
# extensionMenu() has the fixture's checkbox and runExtensionMenuItem() reached
# `contextMenus.onClicked` with it checked; and that running
# `_execute_action` asked the shell for the fixture's popup. Then that a key the
# shell reserves is no longer the fixture's.
#
# Not here: keys pressed in a page, and the items of its own context menu
# (guard-extension-page.sh).
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the list empty. The shell must
# still hear `extensioncommandschanged` with no fixture in it, its menu must be
# empty, and no command may run.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-commands: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture has guard-extension-tray.sh's key, so its id.
# `packages/domicile-engine/tests/test-extension-commands-guard.sh` holds the
# id and the keys to it.
readonly ID="cobncddhpfhclknjbapgflpohofecjhg"
readonly FILL="Ctrl+Shift+L"
readonly ACTION="Ctrl+Shift+U"

EXTENSION="$SCRIPTS/guard-extension-commands-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-extension-commands-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-commands-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-commands-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-commands-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-commands-socket.log}"

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
  annotate "guard-extension-commands: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-commands: no python3, and the compositor's end of the socket is served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

fresh_broker
rm -f "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The compositor's end, naming the fixture -- or, for the control, nothing.
if [ "$NEGATIVE" = "1" ]; then
  NAMED=()
else
  NAMED=(--unpacked "$EXTENSION")
fi
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" ${NAMED[@]+"${NAMED[@]}"} >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-commands: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 2. The engine. A real window, as guard-extension-tray.sh's.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --ozone-override-screen-size=1024,768 \
  --window-size=1024,768 \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&control=$NEGATIVE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-commands.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" '"GUARD listening"' "$ENGINE_LOG" ||
  echo "the shell module never said it was listening; the verdict below says what that means" >&2

# 3. The wait: the claim ends on the reserved key, the control on its empty menu.
#    Either stops at a failed call.
for _ in $(seq 1 "$TRIES"); do
  grep -qE '"GUARD (reserved|none|failed )' "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# A moment for anything already dispatched to be written out.
sleep 1

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-windows-state.sh for why.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
HEARD=$(saw '"GUARD commands count=')
if [ "$NEGATIVE" = "1" ]; then
  # Any row for the fixture at all: an empty list must leave none.
  MEASURED="control $SENT $HEARD $(saw '"GUARD row ') $(saw '"GUARD none"') $(saw 'domicile: ran command')"
else
  MEASURED="commands $SENT $HEARD $(saw "\"GUARD row fill=$FILL action=$ACTION\"") $(saw '"GUARD ran badge=c:fill"') $(saw '"GUARD menu type=checkbox label=Remember"') $(saw '"GUARD clicked badge=m:remember:true"') $(saw "\"GUARD popup url=chrome-extension://$ID/popup.html\"") $(saw '"GUARD reserved fill=."')"
fi

echo
echo "measured: $MEASURED"
echo "what the shell said:"
grep -F '"GUARD ' "$ENGINE_LOG" | tail -12 || true

# WHICH END TO BLAME. `packages/domicile-engine/tests/test-extension-commands-guard.sh` runs this
# block directly. MEASURED is "commands <sent> <heard> <row> <ran> <menu>
# <clicked> <popup> <reserved>", or "control <sent> <heard> <row> <none> <ran>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"commands 1 1 1 1 1 1 1 1")
  PASSED="the shell heard the fixture's keys, its service worker heard the \
command and the menu item the shell ran, its action's own command asked for its \
popup, and a key the shell reserved is no longer the fixture's"
  ;;
"commands 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so nothing was installed"
  ;;
"commands 1 0 "*)
  FAILURE="the shell heard no extensioncommandschanged at all, so \
ExtensionTray did not bind, or bound and never sent CommandsChanged on \
SetClient"
  ;;
"commands 1 1 0 "*)
  FAILURE="the shell heard the commands, but never the fixture's with the keys \
its manifest suggests: CommandsOf, or CommandService bound none. The GUARD \
lines above say what did arrive"
  ;;
"commands 1 1 1 0 "*)
  FAILURE="runExtensionCommand() did not reach the fixture's \
commands.onCommand: RunCommand, or SendCommand's event. With no GUARD ready \
above, its service worker never ran, or its badge never came"
  ;;
"commands 1 1 1 1 0 "*)
  FAILURE="extensionMenu() never had the fixture's checkbox: ActionMenuOf, or \
MenuReader"
  ;;
"commands 1 1 1 1 1 0 "*)
  FAILURE="runExtensionMenuItem() did not reach the fixture's \
contextMenus.onClicked with the box checked: RunActionMenuItem, or an id the \
newest menu does not have"
  ;;
"commands 1 1 1 1 1 1 1 0")
  FAILURE="a key the shell reserved is still the fixture's: \
reserveExtensionKeys(), ReserveKeys, or IsReservedByShell"
  ;;
"commands 1 1 1 1 1 1 0 "*)
  FAILURE="running _execute_action did not ask the shell for the fixture's \
popup"
  ;;
"control 1 1 0 1 0")
  PASSED="the control is sharp: an empty list left no commands for the fixture \
in a list the shell did hear, its menu was empty and its command did not run"
  ;;
"control 0 "*)
  FAILURE="the list was never sent in the control, so its empty list answers \
nothing"
  ;;
"control 1 0 "*)
  FAILURE="the control heard no extensioncommandschanged, so the fixture's \
absence from it is not a reading"
  ;;
"control 1 1 1 "*)
  FAILURE="the fixture's commands were listed with an empty list, so the \
profile was not fresh"
  ;;
"control 1 1 0 0 "*)
  FAILURE="the menu of an extension that is not installed was not empty, so \
the claim's menu is not the fixture's"
  ;;
"control 1 1 0 1 1")
  FAILURE="a command of an extension that is not installed ran"
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

annotate_from "guard-extension-commands: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
last_words "$ENGINE_LOG" >&2
exit 1
