#!/usr/bin/env bash
# An Electron app in a browser profile: its hello names profile `work`, its
# window opens there, with that profile's extensions, and its page's links go
# to the desk's browser while a popup it keeps a handle on stays the app's.
# See "Browser profiles" in docs/architecture/ELECTRON-APPS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-electron-profile.sh /build/chromium/src
#
# WHY THIS EXISTS. An app's windows were always in the default profile, so a
# password manager switched on only in another profile never ran in them; and
# a link its page opened (target="_blank" rel="noopener") opened in the app's
# own partition, without the user's sign-ins.
#
# Headless and software-composited like the other Electron guards: the shell
# is guard-app-module.js, the compositor stand-in guard-app-module-compositor.py
# with profiles `default`, `work` and `private`, and a python client plays
# `electron-host`. It asserts:
#
#   ready         the hello naming `work` was answered once `work` loaded
#   in work       the engine opened the window in browser profile work
#   link out      a noopener window.open() opened in the desk's browser
#   popup kept    a window.open() the page keeps went the page's own way
#   unknown       the control: a hello naming a profile the desk has not got
#                 is refused
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
  annotate "guard-electron-profile: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-electron-profile-broker}"
COMMAND="${COMMAND:-/tmp/domicile-electron-profile-command}"
ELECTRON="${ELECTRON:-/tmp/domicile-electron-profile-electron}"
CONTROL="${CONTROL:-/tmp/domicile-electron-profile-control}"
PROFILE="${PROFILE:-/tmp/domicile-electron-profile-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-electron-profile-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-electron-profile-socket.log}"
APP_LOG="${APP_LOG:-/tmp/domicile-electron-profile-app.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"
PAGE_LOG="${PAGE_LOG:-/tmp/domicile-electron-profile-page.log}"

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
  annotate "guard-electron-profile: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-electron-profile: no python3, and the compositor and the app are both driven by one"
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
  --directory "$SCRIPTS/guard-electron-socket-app" >"$PAGE_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "Serving HTTP" "$PAGE_LOG" || {
  annotate_from "guard-electron-profile: the page's server never started" "$PAGE_LOG"
  exit 1
}
PORT="$(sed -n 's/.*port \([0-9]*\).*/\1/p' "$PAGE_LOG" | head -1)"
PAGE="http://127.0.0.1:$PORT/index.html"

# 1. The compositor's end of the control socket, with the profiles.
rm -f "$SOCKET_LOG"
PROFILES='{"profiles": [{"id": "default", "name": "Default", "color": "#0d9488", "private": false, "extensions": null}, {"id": "work", "name": "Work", "color": "#d97706", "private": false, "extensions": null}, {"id": "private", "name": "Private", "color": "#a78bfa", "private": true, "extensions": null}], "default_profile": "default", "default_private_profile": "private", "sites": {}}'
python3 "$SCRIPTS/guard-app-module-compositor.py" --socket "$CONTROL" \
  --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-electron-profile: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
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

# 3. The app: one connection, as `electron-host` holds one, and then another
# naming a profile the desk has not got. Prints each event it hears, then what
# it measured.
python3 - "$ELECTRON" "$PAGE" "$FOR_SECONDS" >"$APP_LOG" 2>&1 <<'PY'
import json, socket, sys, time

path, page, seconds = sys.argv[1], sys.argv[2], float(sys.argv[3])

def connect():
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
    return connection, connection.makefile("r", encoding="utf-8")

def send(connection, request):
    connection.sendall((json.dumps(request) + "\n").encode())

def hear_until(connection, reader, wanted):
    """Reads events until one matches `wanted` or time runs out."""
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
        if wanted(event):
            return event
    return None

def hello(profile):
    return {"type": "hello", "version": 1, "app_id": "guard.electron",
            "partition": "persist:electron-guard", "profile": profile}

try:
    app, reader = connect()
except OSError as failure:
    print("no socket: %s" % failure, flush=True)
    print("measured: 0 0", flush=True)
    sys.exit(0)

send(app, hello("work"))
ready = hear_until(app, reader, lambda e: e["type"] in ("ready", "refused"))
send(app, {"type": "open_window", "window": 1, "url": page})
loaded = hear_until(app, reader, lambda e: e.get("window") == 1 and
                    e["type"] in ("window_loaded", "window_refused"))
if loaded is not None and loaded["type"] == "window_loaded":
    # As a click would: a noopener link, then a popup the page keeps.
    for call, code in (
        (1, "window.open('%s?link', '_blank', 'noopener'); 1" % page),
        (2, "window.open('%s?popup', 'popup'); 2" % page),
    ):
        send(app, {"type": "execute_javascript", "window": 1, "call": call,
                   "code": code, "user_gesture": True})
        hear_until(app, reader, lambda e: e.get("type") == "javascript_result"
                   and e.get("call") == call)

unknown = None
try:
    other, other_reader = connect()
    send(other, hello("nowhere"))
    unknown = hear_until(other, other_reader,
                         lambda e: e["type"] in ("ready", "refused"))
except OSError as failure:
    print("no second connection: %s" % failure, flush=True)

print("measured: %d %d" % (
    ready is not None and ready["type"] == "ready",
    unknown is not None and unknown["type"] == "refused" and
    unknown.get("why") == "the desk has no browser profile nowhere"),
    flush=True)
PY
sleep 2

# The engine's side: the window's profile, and where each new window went.
READ="$(awk -v page="$PAGE" '
  /domicile: opened Electron app guard\.electron.s window [0-9]+ in browser profile work\./ { work = 1 }
  index($0, "domicile: an app'"'"'s page opened " page "?link in the desk'"'"'s browser.") { out = 1 }
  index($0, "domicile: an app'"'"'s page opened " page "?popup") { popup_out = 1 }
  /domicile: made browser window [0-9]+ for a page.s new window/ { made++ }
  END { printf "%d %d %d\n", work, out, (made >= 1 && !popup_out) }
' "$ENGINE_LOG" 2>/dev/null)"
APP="$(sed -n 's/^measured: //p' "$APP_LOG")"
# "<ready> <unknown-refused>" and "<in-work> <link-out> <popup-kept>", in the
# verdict's order.
set -- $APP $READ
MEASURED="${1:-0} ${3:-0} ${4:-0} ${5:-0} ${2:-0}"
echo
echo "measured: $MEASURED"
echo "  (ready in-work link-out popup-kept unknown-refused)"

# Which end to blame. `packages/domicile-engine/tests/test-electron-profile-guard.sh`
# runs this block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"1 1 1 1 1")
  PASSED="an Electron app's window opened in browser profile work, its \
noopener link opened in the desk's browser, its popup stayed the app's, and a \
profile the desk has not got was refused"
  ;;
"0 "*)
  FAILURE="the hello naming profile work was not answered ready: \
ElectronApp waits on ElectronDesk::WhenProfileReady, which waits on \
BrowserProfileRegistry::WhenAppProfileReady for the compositor's profiles and \
the load -- the app's log says what it heard"
  ;;
"1 0 "*)
  FAILURE="THE APP'S WINDOW DID NOT OPEN IN PROFILE WORK: ElectronApp::Open \
must pass the hello's profile to the desk, and DeskWindows::OpenElectron to \
Make, so the guest is made in that profile's context"
  ;;
"1 1 0 "*)
  FAILURE="THE APP'S NOOPENER LINK DID NOT OPEN IN THE DESK'S BROWSER: patch \
0239 asks WebViewGuest::OpenedNoopenerWindowOutside, which opens it only when \
OpenElectron called OpenLinksInTheBrowser -- otherwise it opens in the app's \
partition, without the user's sign-ins"
  ;;
"1 1 1 0 "*)
  FAILURE="A POPUP THE PAGE KEEPS LEFT THE APP: only a noopener window may go \
to the desk's browser; one with an opener is a sign-in popup the page talks to"
  ;;
"1 1 1 1 0")
  FAILURE="A HELLO NAMING A PROFILE THE DESK HAS NOT GOT WAS NOT REFUSED: \
WhenAppProfileReady must say so, and the app hear it as refused"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-electron-profile: $FAILURE" "$ENGINE_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the app heard:" >&2
tail -20 "$APP_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
