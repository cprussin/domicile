#!/usr/bin/env bash
# A file chooser an agent's press opens waits for the agent, not the shell.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-agent-file-chooser.sh /build/chromium/src
#
# The shell (guard-agent-input-keeps-focus.js) draws a browser window whose
# page is a full-page `<input type="file">` (guard-webview-file-chooser-server.py's
# /upload). The guard presses on it as an agent does, with `devtools <window>`
# on the engine's command socket, then reads and answers the chooser with
# Domicile's own methods. It asserts:
#
#   held        the browser held the request for the agent, and the shell was
#               never asked
#   described   Domicile.fileChooser answers its mode, `open`
#   refused     Domicile.chooseFiles with a file that is not there is refused,
#               and the request still waits
#   read        Domicile.chooseFiles with a file reaches the page, which reads
#               its contents: the browser granted it the file
#   answered    Domicile.fileChooser then answers no chooser
#
# Control: NEGATIVE=1 presses through window `shell` at the window's place on
# the desk, as the engine's guards press for a person. The shell must be asked
# and the agent must see no chooser, so a held request in the positive run is
# the agent's press's doing.
#
# Headless, with no compositor or client. `HOME` is a directory this script
# makes, so the chosen path names no file on the machine.
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
  annotate "guard-agent-file-chooser: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-agent-file-chooser$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-agent-file-chooser$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-agent-file-chooser$WHICH-profile}"
HOME_DIR="${HOME_DIR:-/tmp/domicile-agent-file-chooser$WHICH-home}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-agent-file-chooser$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-agent-file-chooser$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# The strip over the window, in CSS pixels. Not named `STRIP`: `nix develop
# .#full` exports STRIP=strip.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
# Where the press lands in the window's page, which the input fills.
PAGE_X=200
PAGE_Y=200

# The file the agent chooses, and its contents.
PICK="$HOME_DIR/agent/guard-agent-upload.txt"
TEXT="a file an agent chose"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -rf "$HOME_DIR"
  rm -f "$COMMAND"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-agent-file-chooser: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-agent-file-chooser: no python3, and the page and the agent are both driven by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE" "$HOME_DIR"; mkdir -p "$PROFILE"
mkdir -p "$(dirname "$PICK")"
printf '%s' "$TEXT" >"$PICK"
rm -f "$ENGINE_LOG" "$COMMAND" "$HTTP_LOG"

# Waits up to `$1` quarter-seconds for `$2` to appear in `$3`.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# Sends JSON line $1 to the engine's command socket, and prints its answer.
asked() {
  python3 - "$COMMAND" "$1" <<'PY' 2>&1
import socket, sys

path, line = sys.argv[1], sys.argv[2]
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(15)
    connection.connect(path)
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
PY
}

# `devtools` for window $1, method $2, params $3.
devtools() {
  asked "{\"type\":\"devtools\",\"version\":1,\"window\":\"$1\",\"method\":\"$2\",\"params\":$3}"
}

# 1. The browser window's page; `crux` cannot reach external hosts.
python3 "$SCRIPTS/guard-webview-file-chooser-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-agent-file-chooser: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-agent-file-chooser: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/upload"

# 2. The engine, with this guard's home.
HOME="$HOME_DIR" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-agent-input-keeps-focus.js" \
  --domicile-command-socket="$COMMAND" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  grep -qF "GUARD shell-loaded" "$ENGINE_LOG" 2>/dev/null && [ -S "$COMMAND" ] && break
  sleep 0.25
done

# 3. A browser window, as `domicile open` opens one.
OPENED="$(asked "{\"type\":\"open_url\",\"version\":1,\"url\":\"$PAGE\"}")"
wait_for_line "$TRIES" "GUARD upload-loaded" "$ENGINE_LOG"
WINDOW="$(sed -n 's/.*GUARD window id=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
# Hit testing uses submitted compositor frames, and the page's first frame may
# lag its load.
sleep 3

# 4. The press on the input. The control presses as the guards press for a
# person.
press() { # $1 window, $2 x, $3 y
  for kind in mousePressed mouseReleased; do
    devtools "$1" Input.dispatchMouseEvent \
      "{\"type\":\"$kind\",\"x\":$2,\"y\":$3,\"button\":\"left\",\"buttons\":1,\"clickCount\":1}"
  done
}
if [ "$NEGATIVE" = "1" ]; then
  PRESSED="$(press shell "$PAGE_X" $((STRIP_HEIGHT + PAGE_Y)))"
  wait_for_line 40 "GUARD shell-asked-for-files" "$ENGINE_LOG"
else
  PRESSED="$(press "$WINDOW" "$PAGE_X" "$PAGE_Y")"
  wait_for_line 40 "holding it for the agent, not the shell" "$ENGINE_LOG"
fi
# A shell that is asked after all says so by now.
sleep 1

# 5. The agent reads the chooser and answers it.
CHOOSER="$(devtools "$WINDOW" Domicile.fileChooser '{}')"
if [ "$NEGATIVE" != "1" ]; then
  MISSING="$(devtools "$WINDOW" Domicile.chooseFiles "{\"files\":[\"$HOME_DIR/agent/not-there.txt\"]}")"
  STILL="$(devtools "$WINDOW" Domicile.fileChooser '{}')"
  CHOSEN="$(devtools "$WINDOW" Domicile.chooseFiles "{\"files\":[\"$PICK\"]}")"
  wait_for_line 40 "GUARD picked name=" "$ENGINE_LOG"
  AFTER="$(devtools "$WINDOW" Domicile.fileChooser '{}')"
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD upload-loaded")
SAW_PRESS=$(saw "GUARD guest-mousedown")
SAW_HELD=$(saw "holding it for the agent, not the shell")
SAW_SHELL_ASKED=$(saw "GUARD shell-asked-for-files")
SAW_READ=$(saw "GUARD picked name=$(basename "$PICK") text=$TEXT")
SAW_ANY_PICK=$(saw "GUARD picked name=")
contains() { # $1 text, $2 pattern
  case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac
}
DESCRIBED=$(contains "$CHOOSER" '"mode":"open"')

echo "opened: $OPENED, window $WINDOW"
echo "pressed: ${PRESSED:0:200}"
echo "chooser: ${CHOOSER:0:300}"
echo "missing file: ${MISSING:-}"
echo "still waiting: ${STILL:-}"
echo "chosen: ${CHOSEN:-}"
echo "after: ${AFTER:-}"
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_PRESS held=$SAW_HELD shell-asked=$SAW_SHELL_ASKED read=$SAW_READ any-pick=$SAW_ANY_PICK"

FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the module did not load, or it threw"
elif [ -z "$WINDOW" ] || [ "$SAW_PAGE" != "1" ]; then
  FAILURE="no browser window loaded the page (open_url answered $OPENED), so nothing was pressed"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the press never reached the browser window's page, so no chooser could open"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_SHELL_ASKED" = "1" ] && [ "$SAW_HELD" = "0" ] && [ "$(contains "$CHOOSER" chooser)" = "0" ]; then
    PASSED="the control is sharp: a press that is no agent's asks the shell, and the agent sees no chooser"
  else
    FAILURE="the control's press, no agent's, did not ask the shell (shell-asked=$SAW_SHELL_ASKED held=$SAW_HELD, Domicile.fileChooser answered ${CHOOSER:0:200}), so a held request in the positive run proves nothing"
  fi
elif [ "$SAW_SHELL_ASKED" = "1" ]; then
  FAILURE="THE AGENT'S CHOOSER ASKED THE SHELL: its press opened a picker in the user's shell. See WebViewGuest::AskForFiles and NoteAgentInput"
elif [ "$SAW_HELD" != "1" ]; then
  FAILURE="the agent's press opened no file chooser the browser held: RunFileChooser never ran, or did not hold it for the agent"
elif [ "$DESCRIBED" != "1" ]; then
  FAILURE="Domicile.fileChooser did not describe the held chooser in mode open: ${CHOOSER:0:200}"
elif [ "$(contains "$MISSING" refused)" != "1" ] || [ "$(contains "$STILL" '"mode":"open"')" != "1" ]; then
  FAILURE="a file that is not there was not refused, or the refusal dropped the chooser (answered ${MISSING:0:200}, then ${STILL:0:200})"
elif [ "$SAW_READ" != "1" ]; then
  FAILURE="the agent's file did not reach the page (Domicile.chooseFiles answered ${CHOSEN:0:200}; the page got a file: $SAW_ANY_PICK)"
elif [ "$(contains "$AFTER" chooser)" != "0" ]; then
  FAILURE="the chooser still waits after the agent answered it: ${AFTER:0:200}"
else
  PASSED="an agent's press on a file input held the chooser for the agent, the shell was never asked, a missing file was refused, and the file the agent chose reached the page, which read it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi
annotate_from "guard-agent-file-chooser: $FAILURE" "$ENGINE_LOG"
echo "guard-agent-file-chooser: $FAILURE" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
