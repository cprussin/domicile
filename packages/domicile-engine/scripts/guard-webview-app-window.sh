#!/usr/bin/env bash
# Checks an app window is listed with `isApp` and records no visits, and that
# a shell's `openAppWindow` opens one.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-app-window.sh /build/chromium/src
#
# Headless and software-composited: nothing is measured in pixels.
#
# `domicile open-app` sends `open_url` with `"app":true` to the engine's
# command socket. DeskWindows opens the window with AttachAppTabHelpers, which
# leaves out the HistoryTabHelper, and lists it `isApp`
# (docs/architecture/WEB-APPS.md, docs/HISTORY.md).
#
# The guard sends that line for the subject page, then an ordinary `open_url`
# for a sentinel page. An extension reports the history after each visit and
# when its worker starts, since the worker can start after both visits.
# Visits are recorded in order, so once the sentinel is in the history the
# subject would be too, had it been recorded. The shell also opens a page of
# its own with `openAppWindow`, which BrowserWindowsService::OpenApp opens as
# `open_url` does.
#
# Asserts, in order (each only meaningful if the previous holds):
#
#   the shell ran                       it can list windows
#   the engine answered `opened`        the command reached the engine
#   the subject's window is listed      the shell can draw it
#   it is listed `isApp`                the shell draws it as an app
#   its page loaded                     there was a visit to record
#   the sentinel is in the history      history is recorded and read, so the
#                                       subject's absence means something
#   the subject is not                  the claim
#   the shell's window is listed        the shell's call reached the browser
#   it is listed `isApp`                the claim for openAppWindow
#
# NEGATIVE=1 opens the subject as an ordinary window, and the shell's with
# `openBrowserWindow`. The subject must be recorded and neither listed
# `isApp`, so a run where nothing is recorded, or every window says app,
# cannot pass.
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
  annotate "guard-webview-app-window: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 opens the subject as an ordinary window. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-app-window$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-webview-app-window$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-webview-app-window$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-app-window$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-app-window$WHICH-http.log}"
EXTENSION="$SCRIPTS/guard-webview-app-window-extension"

# Time for each step: the shell, each page, the history report. Generous
# because every step is asynchronous and the machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -f "$COMMAND"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-app-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-app-window: no python3, and the pages and the commands are both driven by one"
  exit 77
}

fresh_broker
rm -f "$COMMAND"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

TRIES=$((FOR_SECONDS * 4))
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    grep -qF "Received signal" "$ENGINE_LOG" 2>/dev/null && return 1
    sleep 0.25
  done
  return 1
}

# Sends `open_url` for $1 to the engine's command socket and prints its answer.
# $2 is `true` for an app window.
open_url() {
  python3 - "$COMMAND" "$1" "$2" <<'EOF' 2>&1
import json, socket, sys

path, url, app = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
line = json.dumps({"type": "open_url", "version": 1, "url": url, "app": app})
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
EOF
}

# 1. The pages.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-app-window-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-app-window: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-app-window: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
APP=true
[ "$NEGATIVE" = "1" ] && APP=false

# 2. The engine, with the command socket `domicile open-app` uses and the
#    extension that reads the history.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?site=$SITE&app=$APP" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-app-window.js" \
  --domicile-command-socket="$COMMAND" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --load-extension="$EXTENSION" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 3. The subject, once the shell can list it, then the sentinel once the
#    subject's page has loaded.
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG"
SUBJECT_ANSWER="$(open_url "$SITE/subject" "$APP")"
echo "the engine answered the subject (app=$APP): $SUBJECT_ANSWER"
wait_for_line "$TRIES" "GUARD loaded as=subject" "$HTTP_LOG"
SENTINEL_ANSWER="$(open_url "$SITE/sentinel" false)"
echo "the engine answered the sentinel: $SENTINEL_ANSWER"
wait_for_line "$TRIES" "sentinel=1" "$HTTP_LOG"

saw() { # $1 pattern, $2 log
  grep -qF -- "$1" "$2" && echo 1 || echo 0
}

OPENED='{"type":"opened"}'
SAW_SHELL=$(saw "GUARD shell-loaded" "$ENGINE_LOG")
SAW_CRASH=$(saw "Received signal" "$ENGINE_LOG")
OPENED_SUBJECT=0
[ "$SUBJECT_ANSWER" = "$OPENED" ] && OPENED_SUBJECT=1
SAW_WINDOW=$(saw " url=$SITE/subject" "$ENGINE_LOG")
WINDOW_APP=$(saw "app=true url=$SITE/subject" "$ENGINE_LOG")
SAW_SUBJECT=$(saw "GUARD loaded as=subject" "$HTTP_LOG")
OPENED_SENTINEL=0
[ "$SENTINEL_ANSWER" = "$OPENED" ] && OPENED_SENTINEL=1
SAW_SENTINEL=$(saw "sentinel=1" "$HTTP_LOG")
SUBJECT_RECORDED=$(saw "subject=1" "$HTTP_LOG")
SAW_LAUNCHED=$(saw " url=$SITE/launched" "$ENGINE_LOG")
LAUNCHED_APP=$(saw "app=true url=$SITE/launched" "$ENGINE_LOG")

echo
echo "shell=$SAW_SHELL crash=$SAW_CRASH"
echo "subject: opened=$OPENED_SUBJECT listed=$SAW_WINDOW app=$WINDOW_APP loaded=$SAW_SUBJECT recorded=$SUBJECT_RECORDED"
echo "sentinel: opened=$OPENED_SENTINEL recorded=$SAW_SENTINEL"
echo "launched: listed=$SAW_LAUNCHED app=$LAUNCHED_APP"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-app-window-guard.sh` runs this block
# directly.
#
# The subject is an app window in the run and an ordinary one in the control.
FAILURE=""
PASSED=""
WANT_APP=1
WANT_RECORDED=0
[ "$NEGATIVE" = "1" ] && {
  WANT_APP=0
  WANT_RECORDED=1
}
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. Read the dumped stack"
elif [ "$OPENED_SUBJECT" != "1" ]; then
  FAILURE="the engine never answered the subject's open_url with opened: the \
command socket was not bound (--domicile-command-socket), or the engine \
refused. The answer is printed above"
elif [ "$SAW_WINDOW" != "1" ]; then
  FAILURE="the subject's window never reached the shell's list. That is \
DeskWindows::Make, BrowserWindowsClient, or DomicileHost's \
browserwindowschanged"
elif [ "$WINDOW_APP" != "$WANT_APP" ]; then
  FAILURE="the subject's isApp is wrong (wanted $WANT_APP), so the shell would \
draw an app as a browser window or the reverse. That is DeskWindows::List or \
DomicileBrowserWindow"
elif [ "$SAW_SUBJECT" != "1" ]; then
  FAILURE="the subject's page never loaded, so there was no visit to record. \
That is the window's attach to the shell's <webview window>"
elif [ "$OPENED_SENTINEL" != "1" ]; then
  FAILURE="the engine never answered the sentinel's open_url with opened, so \
nothing proves the history is read. The answer is printed above"
elif [ "$SAW_SENTINEL" != "1" ]; then
  FAILURE="the sentinel, an ordinary window, never showed up in the history, \
so the subject's absence means nothing. Check AttachTabHelpers gives an \
ordinary window a HistoryTabHelper, and that the extension's worker started \
and reported to the page server"
elif [ "$SUBJECT_RECORDED" != "$WANT_RECORDED" ] && [ "$NEGATIVE" = "1" ]; then
  FAILURE="the subject, opened as an ordinary window, is not in the history \
while the sentinel is, so the run's absence proves nothing. That is \
AttachTabHelpers or the extension's report"
elif [ "$SUBJECT_RECORDED" != "$WANT_RECORDED" ]; then
  FAILURE="THE APP WINDOW RECORDED A VISIT: its page is in the history. Check \
DeskWindows opens an app window with AttachAppTabHelpers, which leaves out \
the HistoryTabHelper (domicile_browser_windows.cc)"
elif [ "$SAW_LAUNCHED" != "1" ]; then
  FAILURE="the window the shell opened itself (openAppWindow, or \
openBrowserWindow in the control) never reached its list. That is \
DomicileHost::openAppWindow or the shell's call, whose console is in the \
engine log"
elif [ "$LAUNCHED_APP" != "$WANT_APP" ]; then
  FAILURE="the window the shell opened itself has the wrong isApp (wanted \
$WANT_APP), so a shell's launcher would open apps as browser windows or the \
reverse. That is BrowserWindowsService::OpenApp"
elif [ "$NEGATIVE" = "1" ]; then
  PASSED="the control is sharp: the subject opened as an ordinary window is \
recorded and not listed as an app, and so is the shell's openBrowserWindow"
else
  PASSED="an app window is listed with isApp and records no visit, while an \
ordinary window opened after it does; the shell's openAppWindow opens one too"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-app-window: $FAILURE"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
