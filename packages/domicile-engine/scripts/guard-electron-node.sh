#!/usr/bin/env bash
# Node.js in the pages of Electron windows that aren't sandboxed, as Electron
# has it: the renderer starts unsandboxed for that page alone, its preload
# loads with Node's require beside `require("electron")`, Node's loop turns
# off the renderer's own, and the page's own world has Node only with
# nodeIntegration and no context isolation. See "Phase 2" in
# docs/architecture/ELECTRON-APPS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-electron-node.sh /build/chromium/src
#
# Set up as guard-electron-preload.sh is. A python client plays
# `electron-host` and opens four windows on guard-electron-node-app, the
# first three with `node` and its preload.js:
#
#   1  nodeIntegration, no context isolation
#   2  sandbox: false, context isolation
#   3  sandbox: false, no context isolation, no nodeIntegration
#   4  the control: sandboxed, without a preload
#
# and asserts:
#
#   ready       the socket took the hello
#   preloaded   window 1's preload ran on Node, in an unsandboxed renderer:
#               Node's process, the app's environment, Electron's versions,
#               the app's own module by a relative require, and `electron`
#   integrated  window 1's page has Node's require, its relative requires
#               from the app's directory
#   looped      a Node timer and a file read in window 1's preload called back
#   isolated    window 2's preload had Node; its page has neither require nor
#               process
#   stripped    window 3's page, in the preload's world, lost Node's globals
#               once the preload ran
#   unnoded     the control: window 4 has no Node
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
  annotate "guard-electron-node: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-electron-node-broker}"
COMMAND="${COMMAND:-/tmp/domicile-electron-node-command}"
ELECTRON="${ELECTRON:-/tmp/domicile-electron-node-electron}"
CONTROL="${CONTROL:-/tmp/domicile-electron-node-control}"
PROFILE="${PROFILE:-/tmp/domicile-electron-node-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-electron-node-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-electron-node-socket.log}"
APP_LOG="${APP_LOG:-/tmp/domicile-electron-node-app.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"
PAGE_LOG="${PAGE_LOG:-/tmp/domicile-electron-node-page.log}"

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
  annotate "guard-electron-node: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-electron-node: no python3, and the compositor and the app are both driven by one"
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
  --directory "$SCRIPTS/guard-electron-node-app" >"$PAGE_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "Serving HTTP" "$PAGE_LOG" || {
  annotate_from "guard-electron-node: the page's server never started" "$PAGE_LOG"
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
  annotate_from "guard-electron-node: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
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
APP_DIR="$SCRIPTS/guard-electron-node-app"
python3 - "$ELECTRON" "$PAGE" "$FOR_SECONDS" "$APP_DIR" >"$APP_LOG" 2>&1 <<'PY'
import json, socket, sys, time

path, page, seconds, app_dir = (
    sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4])
heard = []

def send(request):
    connection.sendall((json.dumps(request) + "\n").encode())

def hear_until(wanted):
    """Reads events until one matches `wanted` or time runs out."""
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
        if wanted(event):
            return event
    return None

def message(window, channel):
    return lambda e: (e.get("type") == "ipc_message" and
                      e.get("window") == window and
                      e.get("channel") == channel)

def said(window, channel):
    event = hear_until(message(window, channel))
    return event["args"][0] if event and event.get("args") else None

def node(integration, context_isolation):
    return {"preload": app_dir + "/preload.js", "integration": integration,
            "context_isolation": context_isolation,
            "resources_path": app_dir, "app_path": app_dir,
            "electron_version": "45.2.1",
            "env": {"DOMICILE_GUARD_NODE": "yes"}}

try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
except OSError as failure:
    print("no socket: %s" % failure, flush=True)
    print("measured: 0 0 0 0 0 0 0", flush=True)
    sys.exit(0)
reader = connection.makefile("r", encoding="utf-8")

send({"type": "hello", "version": 1, "app_id": "guard.electron",
      "partition": "persist:electron-guard"})
ready = hear_until(lambda e: e["type"] in ("ready", "refused"))
send({"type": "open_window", "window": 1, "url": page,
      "node": node(True, False)})
preload_1 = said(1, "preload")
page_1 = said(1, "page")
ticked = said(1, "ticked")
read = said(1, "read")
send({"type": "open_window", "window": 2, "url": page,
      "node": node(False, True)})
preload_2 = said(2, "preload")
page_2 = said(2, "page")
send({"type": "open_window", "window": 3, "url": page,
      "node": node(False, False)})
page_3 = said(3, "page")
send({"type": "open_window", "window": 4, "url": page})
control = hear_until(lambda e: e.get("type") == "title_changed" and
                     e.get("window") == 4 and e.get("title") == "no node")

print("preload 1: %s" % json.dumps(preload_1), flush=True)
print("page 1: %s" % json.dumps(page_1), flush=True)
print("preload 2: %s" % json.dumps(preload_2), flush=True)
print("page 2: %s" % json.dumps(page_2), flush=True)
print("page 3: %s" % json.dumps(page_3), flush=True)
print("measured: %d %d %d %d %d %d %d" % (
    ready is not None and ready["type"] == "ready",
    preload_1 == {"chrome": "string", "electron": "45.2.1", "env": "yes",
                  "helper": 42, "isolated": False, "node": "string",
                  "type": "renderer", "unsandboxed": True},
    page_1 == {"dirname": "string", "helper": 42, "joined": "a/b",
               "process": "object"},
    ticked is True and read is True,
    preload_2 is not None and preload_2.get("isolated") is True and
    preload_2.get("node") == "string" and
    page_2 == {"process": "undefined", "require": "undefined"},
    page_3 == {"buffer": "undefined", "process": "undefined",
               "require": "undefined"},
    control is not None), flush=True)
PY

MEASURED="$(sed -n 's/^measured: //p' "$APP_LOG")"
# The browser started each Node page's renderer for it: one line each.
OWN="$(grep -c "starts for an Electron page with Node.js" "$ENGINE_LOG")"
echo
echo "measured: $MEASURED (renderers started for Node: $OWN)"
echo "  (ready preloaded integrated looped isolated stripped unnoded)"
if [ "${MEASURED%% *}" = "1" ] && [ "$OWN" -lt 3 ]; then
  MEASURED="own-renderers-missing"
fi

# Which end to blame. `packages/domicile-engine/tests/test-electron-node-guard.sh`
# runs this block directly. MEASURED is "<ready> <preloaded> <integrated>
# <looped> <isolated> <stripped> <unnoded>", or own-renderers-missing.
FAILURE=""
PASSED=""
case "$MEASURED" in
"1 1 1 1 1 1 1")
  PASSED="each Electron window that isn't sandboxed got a renderer started \
for its page, its preload ran on Node with the app's environment, modules and \
electron, Node's loop called back, the page's own world had Node only with \
nodeIntegration and no context isolation, and a sandboxed window had none"
  ;;
"own-renderers-missing")
  FAILURE="A NODE PAGE RAN IN A RENDERER NOT STARTED FOR IT: \
ContentBrowserClient::MainFrameNavigatesInto must mark the renderer before \
it starts, and ElectronPage::AppendRendererSwitches start it unsandboxed with \
the Node switch (patch 0236) -- the engine's log has which renderers started"
  ;;
"0 "*)
  FAILURE="the Electron socket did not take the app's hello -- \
guard-electron-socket.sh is the guard for that"
  ;;
"1 0 "*)
  FAILURE="window 1's preload never said what Node it had, or had the wrong \
one: the renderer must start for Node (ElectronPage::AppendRendererSwitches), \
ElectronPreload::Run start ElectronNodeEnvironment, and its kNodeInit set \
process, the app's env and require(\"electron\") before loading the preload \
-- the app's log has what the preload said, the engine's any Node error"
  ;;
"1 1 0 "*)
  FAILURE="window 1's page did not get Node's require with nodeIntegration and \
no context isolation, or its relative require did not start from the app's \
directory: kNodeInit's makeRequireFunction and the page's module paths"
  ;;
"1 1 1 0 "*)
  FAILURE="Node's loop never called back in the page: \
ElectronNodeEnvironment::StartPolling, its thread's Poll and RunOnce, or \
Activate for a timer set from the page's side"
  ;;
"1 1 1 1 0 "*)
  FAILURE="WINDOW 2'S PAGE SAW NODE through context isolation, or its preload \
had none: Node starts in the preload's isolated world, and the page gets only \
what contextBridge exposed"
  ;;
"1 1 1 1 1 0 "*)
  FAILURE="WINDOW 3'S PAGE KEPT NODE'S GLOBALS without nodeIntegration: \
kNodeInit removes process, Buffer and the rest from the page's world once the \
preload ran, as Electron does"
  ;;
"1 1 1 1 1 1 0")
  FAILURE="A SANDBOXED WINDOW GOT NODE, or its page never loaded: only a \
window opened with \"node\" gets Node"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-electron-node: $FAILURE" "$ENGINE_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the app heard:" >&2
tail -20 "$APP_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
