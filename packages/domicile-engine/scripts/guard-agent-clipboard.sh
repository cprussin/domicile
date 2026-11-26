#!/usr/bin/env bash
# An agent's copy in a browser window stays off the user's clipboard.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-agent-clipboard.sh /build/chromium/src
#
# The shell (guard-agent-input-keeps-focus.js) has the user's text field
# focused in a strip, over a browser window whose page is one text field
# (guard-agent-input-keeps-focus-page.py). The user copies in their field. An
# agent, through `devtools <window>` for seat agent-1 as `domicile mcp` sends
# it, types in the page, copies, types over it and pastes. Then the user
# pastes. It asserts:
#
#   agent's     the agent's paste in the page gets the agent's copy
#   user's      the user's paste in the shell gets the user's copy, never the
#               agent's
#
# Control: NEGATIVE=1 sends the agent's methods for no seat, as a person's
# `domicile devtools` does. Those copies are the desktop's, so the user's
# paste must get the agent's text, and a clean paste in the positive run is the
# agent's clipboard's doing.
#
# Headless, with no compositor: the engine's own process clipboard stands in
# for the desktop's. See docs/architecture/AGENT-SEATS.md#clipboard.
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
  annotate "guard-agent-clipboard: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-agent-clipboard$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-agent-clipboard$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-agent-clipboard$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-agent-clipboard$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-agent-clipboard$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# The user's strip, in CSS pixels. Not named `STRIP`: `nix develop .#full`
# exports STRIP=strip.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
# Where the agent presses, in the browser window's page.
PAGE_X=40
PAGE_Y=40

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
  annotate "guard-agent-clipboard: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-agent-clipboard: no python3, and the page and the agent are both driven by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
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

# `devtools` for window $1, method $2, params $3, as a person's script sends
# it: for no agent seat.
devtools() {
  asked "{\"type\":\"devtools\",\"version\":1,\"window\":\"$1\",\"method\":\"$2\",\"params\":$3}"
}

# `devtools` as `domicile mcp` sends it for agent seat agent-1. The control
# names no seat.
agent_devtools() {
  if [ "$NEGATIVE" = "1" ]; then
    devtools "$@"
  else
    asked "{\"type\":\"devtools\",\"version\":1,\"window\":\"$1\",\"agent\":\"agent-1\",\"method\":\"$2\",\"params\":$3}"
  fi
}

# 1. The browser window's page; `crux` cannot reach external hosts.
python3 "$SCRIPTS/guard-agent-input-keeps-focus-page.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-agent-clipboard: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-agent-clipboard: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# 2. The engine, with the user's field focused.
"$CHROMIUM/$OUT/chrome" \
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
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG"
WINDOW="$(sed -n 's/.*GUARD window id=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
# Hit testing uses submitted compositor frames, and the page's first frame may
# lag its load.
sleep 3

# The last value field $1, user or guest, took.
last_value() { # $1 user or guest
  sed -n "s/.*GUARD $1-input value=\\([^\"]*\\).*/\\1/p" "$ENGINE_LOG" | tail -1
}

# Waits up to 10 seconds for field $1 to hold $2.
wait_for_value() { # $1 user or guest, $2 value
  for _ in $(seq 1 40); do
    [ "$(last_value "$1")" = "$2" ] && return 0
    sleep 0.25
  done
  return 1
}

# 4. The user copies in their field, which has the shell's focus.
key() { # $1 devtools function, $2 window, $3 key, $4 code, $5 key code, $6 command
  "$1" "$2" Input.dispatchKeyEvent \
    "{\"type\":\"rawKeyDown\",\"modifiers\":2,\"key\":\"$3\",\"code\":\"$4\",\"windowsVirtualKeyCode\":$5,\"commands\":[\"$6\"]}" >/dev/null
  "$1" "$2" Input.dispatchKeyEvent \
    "{\"type\":\"keyUp\",\"modifiers\":2,\"key\":\"$3\",\"code\":\"$4\",\"windowsVirtualKeyCode\":$5}" >/dev/null
}
USERS="the user's copy"
AGENTS="an agent's copy"
devtools shell Input.insertText "{\"text\":\"$USERS\"}" >/dev/null
wait_for_line 40 "GUARD user-input value=$USERS" "$ENGINE_LOG"
key devtools shell a KeyA 65 selectAll
key devtools shell c KeyC 67 copy

# 5. The agent types, copies, types over its text and pastes it back.
for kind in mousePressed mouseReleased; do
  agent_devtools "$WINDOW" Input.dispatchMouseEvent \
    "{\"type\":\"$kind\",\"x\":$PAGE_X,\"y\":$PAGE_Y,\"button\":\"left\",\"buttons\":1,\"clickCount\":1}" >/dev/null
done
agent_devtools "$WINDOW" Input.insertText "{\"text\":\"$AGENTS\"}" >/dev/null
wait_for_line 40 "GUARD guest-input value=$AGENTS" "$ENGINE_LOG"
key agent_devtools "$WINDOW" a KeyA 65 selectAll
key agent_devtools "$WINDOW" c KeyC 67 copy
agent_devtools "$WINDOW" Input.insertText '{"text":"typed over"}' >/dev/null
wait_for_value guest "typed over"
key agent_devtools "$WINDOW" a KeyA 65 selectAll
key agent_devtools "$WINDOW" v KeyV 86 paste
wait_for_value guest "$AGENTS"

# 6. The user pastes over their own text.
key devtools shell a KeyA 65 selectAll
key devtools shell v KeyV 86 paste
# A paste that changes nothing fires no input; give a leak time to show.
sleep 2

USER_HAS="$(last_value user)"
PAGE_HAS="$(last_value guest)"
saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_TYPED=$(saw "GUARD guest-input value=typed over")
SAW_LEAK=$(saw "GUARD user-input value=$AGENTS")

echo "opened: $OPENED, window $WINDOW"
echo "user's field: $USER_HAS; page's field: $PAGE_HAS"
echo "shell=$SAW_SHELL page=$SAW_PAGE typed=$SAW_TYPED leaked=$SAW_LEAK"

FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the module did not load, or it threw"
elif [ -z "$WINDOW" ] || [ "$SAW_PAGE" != "1" ]; then
  FAILURE="no browser window loaded the page (open_url answered $OPENED), so the agent had nowhere to copy"
elif [ "$SAW_TYPED" != "1" ]; then
  FAILURE="the agent's text never reached the page's field, so nothing was copied"
elif [ "$PAGE_HAS" != "$AGENTS" ]; then
  FAILURE="the agent's paste did not get its own copy: the page's field has \"$PAGE_HAS\""
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$USER_HAS" = "$AGENTS" ]; then
    PASSED="the control is sharp: copies for no agent seat are the desktop's, and the user pastes them"
  else
    FAILURE="the control's copy, for no seat, did not reach the user's paste (their field has \"$USER_HAS\"), so a clean paste in the positive run proves nothing"
  fi
elif [ "$SAW_LEAK" = "1" ]; then
  FAILURE="THE AGENT'S COPY REPLACED THE USER'S CLIPBOARD: the user pasted \"$AGENTS\". See ClipboardHostImpl's Context::GetClipboard and AgentClipboards"
elif [ "$USER_HAS" != "$USERS" ]; then
  FAILURE="the user's paste did not get their own copy: their field has \"$USER_HAS\""
else
  PASSED="the agent copied and pasted its own text in the page, and the user's paste got the user's copy"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi
annotate_from "guard-agent-clipboard: $FAILURE" "$ENGINE_LOG"
echo "guard-agent-clipboard: $FAILURE" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
