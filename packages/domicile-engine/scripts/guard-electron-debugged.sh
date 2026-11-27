#!/usr/bin/env bash
# An Electron app's window opens while a DevTools client is auto-attached to
# new pages, as VS Code's own debugging and any CDP tool may be: the client
# attaches to the window's page and the page loads. See "Page calls" in
# docs/architecture/ELECTRON-APPS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-electron-debugged.sh /build/chromium/src
#
# WHY THIS EXISTS. The engine aborted on `Check failed: zoom` in
# WebViewGuest::Zoom() as VSCodium opened its window with a client
# auto-attached: attaching to a page on its initial empty document calls
# DidAccessInitialMainDocument, a URL change, and the guest reported its zoom
# for it before it had made its ZoomController (WebViewGuest::MakeContents).
#
# Set up as guard-electron-session.sh is, with an HTTP server of its own on
# 127.0.0.1 and the engine's debugging port. A python client plays
# `electron-host` and another is the DevTools client. It asserts:
#
#   ready     the socket took the hello
#   attached  the DevTools client was attached to the window's page as it
#             opened (Target.attachedToTarget)
#   loaded    the window's page loaded and took its title
#   alive     the engine still answered on its debugging port afterwards
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
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-electron-debugged: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-electron-debugged-broker}"
COMMAND="${COMMAND:-/tmp/domicile-electron-debugged-command}"
ELECTRON="${ELECTRON:-/tmp/domicile-electron-debugged-electron}"
CONTROL="${CONTROL:-/tmp/domicile-electron-debugged-control}"
PROFILE="${PROFILE:-/tmp/domicile-electron-debugged-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-electron-debugged-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-electron-debugged-socket.log}"
APP_LOG="${APP_LOG:-/tmp/domicile-electron-debugged-app.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"

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
  annotate "guard-electron-debugged: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-electron-debugged: no python3, and the compositor, the app and the DevTools client are all driven by one"
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

# 1. The compositor's end of the control socket.
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-app-module-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-electron-debugged: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 2. The engine, with the Electron socket and a debugging port.
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
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell never loaded; the verdict below says what that means" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || DEBUG_PORT=0
sleep 1

# 3. The DevTools client auto-attaches to new pages, then the app opens its
# window. Prints each event it hears, then what it measured.
PYTHONPATH="$SCRIPTS" python3 - "$ELECTRON" "$FOR_SECONDS" "$DEBUG_PORT" \
  >"$APP_LOG" 2>&1 <<'PY'
import http.server, json, socket, sys, threading, time, urllib.request

import guard_webview_devtools as devtools

path, seconds, port = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
heard = []
PAGE = b"<!doctype html><title>debugged</title>"

class Server(http.server.BaseHTTPRequestHandler):
    """The network: one page."""
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Server)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = "http://127.0.0.1:%d" % server.server_address[1]

def browser_answers():
    """Whether the engine's browser process still answers its debugging port."""
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:%d/json/version" % port, timeout=10) as answer:
            return "webSocketDebuggerUrl" in json.load(answer)
    except (OSError, ValueError):
        return False

def send(request):
    connection.sendall((json.dumps(request) + "\n").encode())

def hear_until(wanted):
    """Reads app events until one matches `wanted` or time runs out."""
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

attached = []

def watch(debugger):
    """Records every page the client is attached to, until the socket ends."""
    while True:
        try:
            message = devtools.receive(debugger)
        except (devtools.Closed, OSError, ValueError):
            return
        if message.get("method") == "Target.attachedToTarget":
            info = message["params"].get("targetInfo", {})
            print("attached: %s %s" % (info.get("type"), info.get("url")),
                  flush=True)
            attached.append(info)

try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
except OSError as failure:
    print("no socket: %s" % failure, flush=True)
    print("measured: 0 0 0 0", flush=True)
    sys.exit(0)
reader = connection.makefile("r", encoding="utf-8")

send({"type": "hello", "version": 1, "app_id": "guard.electron.debugged",
      "partition": "persist:electron-guard-debugged",
      "electron_version": "45.2.1", "resources_path": "/opt/guard/resources"})
ready = hear_until(lambda e: e["type"] in ("ready", "refused"))

# The browser target, auto-attached to every new page as a CDP tool is:
# `flatten` puts every page's session on this one socket.
auto = None
if port > 0:
    with urllib.request.urlopen(
            "http://127.0.0.1:%d/json/version" % port, timeout=30) as answer:
        browser = json.load(answer)["webSocketDebuggerUrl"]
    debugger = devtools.connect(browser)
    auto = devtools.command(debugger, 1, "Target.setAutoAttach",
                            {"autoAttach": True,
                             "waitForDebuggerOnStart": False,
                             "flatten": True})
    print("auto-attach: %s" % json.dumps(auto), flush=True)
    debugger.settimeout(None)
    threading.Thread(target=watch, args=(debugger,), daemon=True).start()

send({"type": "open_window", "window": 1, "url": origin + "/"})
loaded = hear_until(lambda e: e.get("type") == "title_changed" and
                    e.get("window") == 1 and e.get("title") == "debugged")
# The attach is heard on another socket, so give it its own moment.
for _ in range(40):
    if any(info.get("url", "").startswith(origin) or
           info.get("type") == "page" for info in attached):
        break
    time.sleep(0.25)
alive = browser_answers()

print("measured: %d %d %d %d" % (
    ready is not None and ready["type"] == "ready",
    auto is not None and "error" not in auto and len(attached) > 0,
    loaded is not None,
    alive), flush=True)
server.shutdown()
PY

MEASURED="$(sed -n 's/^measured: //p' "$APP_LOG")"
echo
echo "measured: $MEASURED"
echo "  (ready attached loaded alive)"

# Which end to blame. `packages/domicile-engine/tests/test-electron-debugged-guard.sh`
# runs this block directly. MEASURED is "<ready> <attached> <loaded> <alive>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"1 1 1 1")
  PASSED="an Electron window opened and loaded with a DevTools client \\
auto-attached to it, and the engine lived on"
  ;;
"0 "*)
  FAILURE="the Electron socket did not take the app's hello -- \\
guard-electron-socket.sh is the guard for that"
  ;;
*" 0")
  FAILURE="THE ENGINE DIED AS AN ELECTRON WINDOW OPENED UNDER AN \\
AUTO-ATTACHED DEVTOOLS CLIENT. The last time, WebViewGuest::Zoom() found no \\
ZoomController: the attach reported a URL change, and NavigationStateChanged \\
reported the zoom, before MakeContents made it. Read the dumped stack before \\
assuming it is the same one"
  ;;
"1 0 "*)
  FAILURE="the DevTools client was never attached to the window's page, so \\
nothing here was measured: Target.setAutoAttach failed, the debugging port \\
never came up, or the page was not reported as a target"
  ;;
"1 1 0 1")
  FAILURE="the window's page never loaded under the attached client, though \\
the engine lived: guard-electron-socket.sh loads one without a client, so \\
compare with it"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-electron-debugged: $FAILURE" "$ENGINE_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the app and the client heard:" >&2
tail -20 "$APP_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
