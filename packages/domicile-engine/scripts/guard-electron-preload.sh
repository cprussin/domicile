#!/usr/bin/env bash
# An Electron window's preload and IPC: the preload runs in its own world
# before the page's scripts and exposes an API with contextBridge, the page's
# ipcRenderer.send and invoke reach the app over the Electron socket, and the
# app's webContents.send reaches the page. See
# docs/architecture/ELECTRON-APPS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-electron-preload.sh /build/chromium/src
#
# Set up as guard-electron-preload.sh is. A python client plays
# `electron-host`, opens window 1 with guard-electron-preload-app/preload.js,
# and asserts:
#
#   ready        the socket took the hello
#   preloaded    the page found the preload's API before its own script ran
#   isolated     the page sees neither `require` nor the preload's globals, and
#                cannot replace the exposed API
#   invoked      ipcRenderer.invoke reached the app and its reply came back
#   delivered    the app's ipc_send reached the page's ipcRenderer listener
#   unpreloaded  the control: window 2, opened without a preload, has no API
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
  annotate "guard-electron-preload: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-electron-preload-broker}"
COMMAND="${COMMAND:-/tmp/domicile-electron-preload-command}"
ELECTRON="${ELECTRON:-/tmp/domicile-electron-preload-electron}"
CONTROL="${CONTROL:-/tmp/domicile-electron-preload-control}"
PROFILE="${PROFILE:-/tmp/domicile-electron-preload-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-electron-preload-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-electron-preload-socket.log}"
APP_LOG="${APP_LOG:-/tmp/domicile-electron-preload-app.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"
PAGE_LOG="${PAGE_LOG:-/tmp/domicile-electron-preload-page.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -f "$COMMAND" "$CONTROL" "$ELECTRON"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-electron-preload: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-electron-preload: no python3, and the compositor and the app are both driven by one"
  exit 77
}

fresh_broker
rm -f "$COMMAND" "$CONTROL" "$ELECTRON"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 0. The app's page, over http: content loads no file: URL in a guest.
rm -f "$PAGE_LOG"
python3 -u -m http.server 0 --bind 127.0.0.1 \
  --directory "$SCRIPTS/guard-electron-preload-app" >"$PAGE_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "Serving HTTP" "$PAGE_LOG" || {
  annotate_from "guard-electron-preload: the page's server never started" "$PAGE_LOG"
  exit 1
}
PORT="$(sed -n 's/.*port \([0-9]*\).*/\1/p' "$PAGE_LOG" | head -1)"
PAGE="http://127.0.0.1:$PORT/index.html"

# 1. The compositor's end of the control socket.
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-app-module-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-electron-preload: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 2. The engine, with the Electron socket.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-app-module.js" \
  --domicile-control-socket="$CONTROL" \
  --domicile-command-socket="$COMMAND" \
  --domicile-electron-socket="$ELECTRON" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell never loaded; the verdict below says what that means" >&2
sleep 1

# 3. The app: one connection, as `electron-host` holds one. Prints each event
# it hears, then what it measured.
python3 - "$ELECTRON" "$PAGE" "$FOR_SECONDS" \
  "$SCRIPTS/guard-electron-preload-app/preload.js" >"$APP_LOG" 2>&1 <<'PY'
import json, socket, sys, time

path, page, seconds, preload_path = (
    sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4])
with open(preload_path, encoding="utf-8") as preload_file:
    preload = preload_file.read()
heard = []

def send(request):
    connection.sendall((json.dumps(request) + "\n").encode())

def hear_until(wanted):
    """Reads events until one matches `wanted` or time runs out. Answers each
    invoke of "double" on the way, as an ipcMain handler would."""
    for event in heard:
        if wanted(event):
            return event
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        connection.settimeout(max(0.1, deadline - time.monotonic()))
        try:
            line = reader.readline()
        except (OSError, ValueError):
            return None
        if not line:
            return None
        event = json.loads(line)
        print("heard: %s" % line.strip(), flush=True)
        heard.append(event)
        if event.get("type") == "ipc_invoke" and event.get("channel") == "double":
            send({"type": "ipc_reply", "invoke": event["invoke"],
                  "result": event["args"][0] * 2})
        if wanted(event):
            return event
    return None

def message(window, channel):
    return lambda e: (e.get("type") == "ipc_message" and
                      e.get("window") == window and
                      e.get("channel") == channel)

try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
except OSError as failure:
    print("no socket: %s" % failure, flush=True)
    print("measured: 0 0 0 0 0 0", flush=True)
    sys.exit(0)
reader = connection.makefile("r", encoding="utf-8")

send({"type": "hello", "version": 1, "app_id": "guard.electron",
      "partition": "persist:electron-guard"})
ready = hear_until(lambda e: e["type"] in ("ready", "refused"))
send({"type": "open_window", "window": 1, "url": page, "preload": preload})
said = hear_until(message(1, "page"))
seen = said["args"][0] if said and said.get("args") else {}
answered = hear_until(message(1, "answered"))
send({"type": "ipc_send", "window": 1, "channel": "ping", "args": ["back"]})
pinged = hear_until(lambda e: e.get("type") == "title_changed" and
                    e.get("window") == 1 and e.get("title") == "pinged back")
send({"type": "open_window", "window": 2, "url": page})
control = hear_until(lambda e: e.get("type") == "title_changed" and
                     e.get("window") == 2 and e.get("title") == "no preload")

print("measured: %d %d %d %d %d %d" % (
    ready is not None and ready["type"] == "ready",
    said is not None,
    seen == {"require": "undefined", "secret": "undefined", "kept": True},
    answered is not None and answered.get("args") == [4],
    pinged is not None,
    control is not None), flush=True)
PY

MEASURED="$(sed -n 's/^measured: //p' "$APP_LOG")"
echo
echo "measured: $MEASURED"
echo "  (ready preloaded isolated invoked delivered unpreloaded)"

# Which end to blame. `packages/domicile-engine/tests/test-electron-preload-guard.sh`
# runs this block directly. MEASURED is "<ready> <preloaded> <isolated>
# <invoked> <delivered> <unpreloaded>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"1 1 1 1 1 1")
  PASSED="an Electron window's preload ran before its page in its own world, \
its exposed API reached the app with send and invoke, the app's send reached \
the page, and a window without a preload had none"
  ;;
"0 "*)
  FAILURE="the Electron socket did not take the app's hello -- \
guard-electron-socket.sh is the guard for that"
  ;;
"1 0 "*)
  FAILURE="the page never sent what it saw: the preload did not run before \
the page's script (ElectronPage::ReadyToCommitNavigation must send Preload, \
ElectronPreload::DidCreateDocumentElement run it), contextBridge did not \
expose the API, or ipcRenderer.send did not reach the app (ElectronFrameHost \
Send, ElectronApp::PageSent) -- the engine's log has any console error"
  ;;
"1 1 0 "*)
  FAILURE="THE PAGE SAW INTO THE PRELOAD'S WORLD, or could replace its API: \
the preload must run in its own isolated world and ExposeAcrossWorlds define \
a read-only, permanent copy -- the app's log has what the page saw"
  ;;
"1 1 1 0 "*)
  FAILURE="ipcRenderer.invoke never came back with the app's reply: \
ElectronApp::PageInvoked, ipc_reply, or ElectronPreload::Answered and the \
bootstrap's settle"
  ;;
"1 1 1 1 0 "*)
  FAILURE="the app's ipc_send never reached the page's listener: \
SendToElectronWindow, ElectronPage::SendTo, or ElectronPreload::Deliver"
  ;;
"1 1 1 1 1 0")
  FAILURE="A WINDOW OPENED WITHOUT A PRELOAD GOT ONE, or its page never \
loaded: ElectronPage must send Preload only for its own window, and only \
when the app gave one"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-electron-preload: $FAILURE" "$ENGINE_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the app heard:" >&2
tail -20 "$APP_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
