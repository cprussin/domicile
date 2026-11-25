#!/usr/bin/env bash
# An agent's input into a browser window leaves the user's focus where it is.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-agent-input-keeps-focus.sh /build/chromium/src
#
# The shell (guard-agent-input-keeps-focus.js) has the user's text field
# focused in a strip, and draws a browser window under it whose page is one
# text field (guard-agent-input-keeps-focus-page.py). The guard drives that
# window as an agent does: `devtools <window>` on the engine's command socket,
# as `domicile devtools` sends it, with a press in the page, Input.insertText
# and a key. It asserts:
#
#   pressed     the press reached the page
#   typed       the page's field has the agent's text and key
#   kept        the user's field is still the shell's activeElement, and the
#               shell heard no `domicile-guest-focus` or focusin from the
#               browser window
#   untouched   nothing was typed into the user's field
#
# Control: NEGATIVE=1 sends the same press to window `shell` at the browser
# window's place on the desk: the path a person's click takes. The focus must
# move to the browser window, so a "kept" reading in the positive run is the
# patch's doing and not a guard that cannot see focus move.
#
# Headless, with no compositor or client. See patch 0276.
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
  annotate "guard-agent-input-keeps-focus: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-agent-input-keeps-focus$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-agent-input-keeps-focus$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-agent-input-keeps-focus$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-agent-input-keeps-focus$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-agent-input-keeps-focus$WHICH-http.log}"
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
  annotate "guard-agent-input-keeps-focus: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-agent-input-keeps-focus: no python3, and the page and the agent are both driven by one"
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

# `devtools` for window $1, method $2, params $3.
devtools() {
  asked "{\"type\":\"devtools\",\"version\":1,\"window\":\"$1\",\"method\":\"$2\",\"params\":$3}"
}

# 1. The browser window's page; `crux` cannot reach external hosts.
python3 "$SCRIPTS/guard-agent-input-keeps-focus-page.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-agent-input-keeps-focus: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-agent-input-keeps-focus: its page server never said which port it took" "$HTTP_LOG"
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

# 4. The press, the text and a key. The control presses as a person does.
press() { # $1 window, $2 x, $3 y
  for kind in mousePressed mouseReleased; do
    devtools "$1" Input.dispatchMouseEvent \
      "{\"type\":\"$kind\",\"x\":$2,\"y\":$3,\"button\":\"left\",\"buttons\":1,\"clickCount\":1}"
  done
}
if [ "$NEGATIVE" = "1" ]; then
  PRESSED="$(press shell "$PAGE_X" $((STRIP_HEIGHT + PAGE_Y)))"
else
  PRESSED="$(press "$WINDOW" "$PAGE_X" "$PAGE_Y")"
  TYPED="$(devtools "$WINDOW" Input.insertText '{"text":"agent"}')"
  devtools "$WINDOW" Input.dispatchKeyEvent \
    '{"type":"keyDown","key":"b","code":"KeyB","text":"b","windowsVirtualKeyCode":66}' >/dev/null
  devtools "$WINDOW" Input.dispatchKeyEvent \
    '{"type":"keyUp","key":"b","code":"KeyB","windowsVirtualKeyCode":66}' >/dev/null
fi

# The answers come before the pages handle the events. The control waits for
# a line that must come, so it stops when it does; the agent's run waits for
# its text, then gives a focus move, which must not come, time to show.
if [ "$NEGATIVE" = "1" ]; then
  wait_for_line 80 "GUARD window-reached" "$ENGINE_LOG"
else
  wait_for_line 40 "GUARD guest-input value=agentb" "$ENGINE_LOG"
  sleep 3
fi

# The shell's last activeElement, as its module reports it: agents' devtools
# has no Runtime.evaluate.
sleep 0.5
ACTIVE="$(sed -n 's/.*GUARD active=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | tail -1)"

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_PRESS=$(saw "GUARD guest-mousedown")
SAW_TYPED=$(saw "GUARD guest-input value=agentb")
SAW_FIELD_FOCUS=$(saw "GUARD guest-field-focus")
SAW_USER_INPUT=$(saw "GUARD user-input")
SAW_REACHED=$(saw "GUARD window-reached")
SAW_FOCUSIN=$(saw "GUARD focusin target=webview")
case "$ACTIVE" in
user) KEPT=1 ;;
*) KEPT=0 ;;
esac

echo "opened: $OPENED, window $WINDOW"
echo "pressed: ${PRESSED:0:200}"
echo "typed: ${TYPED:-}"
echo "shell's activeElement: ${ACTIVE:0:200}"
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_PRESS typed=$SAW_TYPED field-focus=$SAW_FIELD_FOCUS"
echo "the shell heard: reached=$SAW_REACHED focusin=$SAW_FOCUSIN user-input=$SAW_USER_INPUT kept=$KEPT"
grep -F "GUARD guest-input" "$ENGINE_LOG" | tail -3

FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the module did not load, or it threw"
elif [ -z "$WINDOW" ] || [ "$SAW_PAGE" != "1" ]; then
  FAILURE="no browser window loaded the page (open_url answered $OPENED), so nothing was driven"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the press never reached the browser window's page, so the focus readings are about a press nobody made"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_REACHED" = "1" ] && [ "$KEPT" = "0" ]; then
    PASSED="the control is sharp: a person's press on the window moves the shell's focus to it, so the positive run can see a move"
  else
    FAILURE="the control's press, a person's, did not move the shell's focus (reached=$SAW_REACHED, activeElement ${ACTIVE:0:120}), so a kept focus in the positive run proves nothing"
  fi
elif [ "$SAW_TYPED" != "1" ]; then
  FAILURE="the agent's text and key did not reach the page's field; they went to the frame the user's focus is in, or nowhere"
elif [ "$SAW_USER_INPUT" = "1" ]; then
  FAILURE="THE AGENT TYPED INTO THE USER'S FIELD: Input.insertText or the key found its widget in the user's focused page"
elif [ "$SAW_REACHED" = "1" ] || [ "$SAW_FOCUSIN" = "1" ] || [ "$KEPT" != "1" ]; then
  FAILURE="THE AGENT'S PRESS MOVED THE USER'S FOCUS: the shell heard the browser window take focus (reached=$SAW_REACHED focusin=$SAW_FOCUSIN), and its activeElement is ${ACTIVE:0:120}. FocusOwningWebContents ran for a press into the guest's own target"
elif [ "$SAW_FIELD_FOCUS" != "1" ]; then
  PASSED="the agent pressed and typed in a browser window and the user's field kept the focus. WITH ONE READING SHORT: the page's field fired no focus event, so the page did not get page focus of its own"
else
  PASSED="the agent pressed and typed in a browser window, its page's field took focus and the text, and the user's field kept the focus and got nothing"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi
annotate_from "guard-agent-input-keeps-focus: $FAILURE" "$ENGINE_LOG"
echo "guard-agent-input-keeps-focus: $FAILURE" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
