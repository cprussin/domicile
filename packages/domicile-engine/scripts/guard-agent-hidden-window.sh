#!/usr/bin/env bash
# A browser window an agent works in runs as shown while its shell hides it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-agent-hidden-window.sh /build/chromium/src
#
# The shell (guard-agent-input-keeps-focus.js) draws a browser window whose
# page is one text field (guard-agent-input-keeps-focus-page.py). A stand-in
# compositor (guard-agent-seat-in-pages-compositor.py) sends an agent seat's
# press in the page, which puts the seat's keyboard there. Then the shell
# makes the window's `<webview>` `display: none`, as a shell hides a window on
# a workspace nobody is looking at. It asserts:
#
#   shown       the page never went hidden while the agent's keyboard is in
#               it
#   typed       the agent's keys a and b reached the field
#   screenshot  the agent's `devtools` Page.captureScreenshot is refused at
#               once, saying the window is not on screen: a page nobody draws
#               presents no frame, and the method would wait for one until it
#               timed out
#   let go      once the agent's keyboard leaves (`blur`), the page is hidden
#
# Control: NEGATIVE=1 moves the agent's keyboard off the page before the
# shell hides it. The page must go hidden, so the positive run's shown page is
# the agent's doing and not a hide that hides nothing.
#
# Headless, with no real compositor or client.
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
  annotate "guard-agent-hidden-window: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-agent-hidden-window$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-agent-hidden-window$WHICH-command}"
CONTROL="${CONTROL:-/tmp/domicile-agent-hidden-window$WHICH-control}"
DRIVE="${DRIVE:-/tmp/domicile-agent-hidden-window$WHICH-drive}"
PROFILE="${PROFILE:-/tmp/domicile-agent-hidden-window$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-agent-hidden-window$WHICH-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-agent-hidden-window$WHICH-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-agent-hidden-window$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# The user's strip, in CSS pixels. Not named `STRIP`: `nix develop .#full`
# exports STRIP=strip.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
# Where the agent presses, on the desk: in the browser window's page, which
# starts under the strip.
DESK_X=40
DESK_Y=$((STRIP_HEIGHT + 40))
SEAT="agent-guard"
# evdev codes, from linux/input-event-codes.h. The desk's keymap
# (guard-agent-hidden-window-compositor.py) types a on qwerty's b key and b on
# its a key.
BTN_LEFT=272
DESK_A=48
DESK_B=30

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -f "$COMMAND" "$CONTROL" "$DRIVE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-agent-hidden-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-agent-hidden-window: no python3, and the page and the compositor are both stood in by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
rm -f "$ENGINE_LOG" "$SOCKET_LOG" "$HTTP_LOG" "$COMMAND"

# Waits up to `$1` quarter-seconds for `$2` to appear in `$3`.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# Sends JSON line $2 to unix socket $1, and prints its answer.
said_to() {
  python3 - "$1" "$2" <<'PY' 2>&1
import socket, sys

path, line = sys.argv[1], sys.argv[2]
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(30)
    connection.connect(path)
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
PY
}

# The agent seat's input $1, barring the windows in JSON list $2.
agent() { # $1 input, $2 barred
  said_to "$DRIVE" "{\"seat\":\"$SEAT\",\"input\":$1,\"barred\":${2:-[]}}"
}


# 1. The browser window's page; `crux` cannot reach external hosts.
python3 "$SCRIPTS/guard-agent-input-keeps-focus-page.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-agent-hidden-window: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-agent-hidden-window: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# 2. The compositor's end of the control socket.
python3 "$SCRIPTS/guard-agent-seat-in-pages-compositor.py" \
  --socket "$CONTROL" --drive "$DRIVE" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "driving on" "$SOCKET_LOG" || {
  annotate_from "guard-agent-hidden-window: the compositor stand-in never listened" "$SOCKET_LOG"
  exit 1
}

# 3. The engine.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-agent-input-keeps-focus.js" \
  --domicile-command-socket="$COMMAND" \
  --domicile-control-socket="$CONTROL" \
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

# 4. A browser window, as `domicile open` opens one.
OPENED="$(said_to "$COMMAND" "{\"type\":\"open_url\",\"version\":1,\"url\":\"$PAGE\"}")"
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG"
# The shell logs the window's id from its own renderer, so the line can come
# after the page's: wait for it too.
wait_for_line "$TRIES" "GUARD window id=" "$ENGINE_LOG"
WINDOW="$(sed -n 's/.*GUARD window id=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
# Hit testing uses submitted compositor frames, and the page's first frame may
# lag its load.
sleep 3

# `devtools` for window $1, method $2, params $3, for the agent seat.
devtools() {
  said_to "$COMMAND" "{\"type\":\"devtools\",\"version\":1,\"window\":\"$1\",\"agent\":\"$SEAT\",\"method\":\"$2\",\"params\":$3}"
}

# 5. The agent's press, which gives its keyboard the page. The control takes
# the keyboard off again.
PRESSED="$(agent "{\"kind\":\"pointer\",\"x\":$DESK_X,\"y\":$DESK_Y}" >/dev/null
  agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":true}")"
agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":false}" >/dev/null
agent "{\"kind\":\"leave\"}" >/dev/null
[ "$NEGATIVE" = "1" ] && agent "{\"kind\":\"blur\"}" >/dev/null

# 6. The shell hides the window. Its field takes the text as the user's
# typing; the shell's own page is never hidden.
devtools shell Input.insertText '{"text":"hide"}' >/dev/null
wait_for_line 40 "GUARD hidden" "$ENGINE_LOG"
# The page hears a hide, which must not come for the positive run, at once:
# patch 0162 holds a step toward hidden 100 ms.
sleep 2
# The log from the hide on, which the page's visibility is read in.
HID_AT="$(grep -nF "GUARD hidden" "$ENGINE_LOG" | head -1 | cut -d: -f1)"
since_the_hide() { # $1 pattern
  tail -n +"${HID_AT:-1}" "$ENGINE_LOG" | grep -qF "$1" && echo 1 || echo 0
}

if [ "$NEGATIVE" != "1" ]; then
  # 7. The agent types, and reads the page as an image.
  TYPED_A="$(agent "{\"kind\":\"key\",\"keycode\":$DESK_A,\"pressed\":true}")"
  agent "{\"kind\":\"key\",\"keycode\":$DESK_A,\"pressed\":false}" >/dev/null
  TYPED_B="$(agent "{\"kind\":\"key\",\"keycode\":$DESK_B,\"pressed\":true}")"
  agent "{\"kind\":\"key\",\"keycode\":$DESK_B,\"pressed\":false}" >/dev/null
  wait_for_line 40 "GUARD guest-input value=ab" "$ENGINE_LOG"
  SHOT="$(devtools "$WINDOW" Page.captureScreenshot '{"format":"png"}')"
  HIDDEN_WHILE_HELD=$(since_the_hide "guest-visibility state=hidden")

  # 8. The agent's keyboard leaves.
  agent "{\"kind\":\"blur\"}" >/dev/null
fi
for _ in $(seq 1 40); do
  [ "$(since_the_hide "guest-visibility state=hidden")" = "1" ] && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_HIDE=$(saw "GUARD hidden")
SAW_PRESS=$(saw "GUARD guest-mousedown")
SAW_TYPED=$(saw "GUARD guest-input value=ab")
SAW_LET_GO=$(since_the_hide "guest-visibility state=hidden")
case "${SHOT:-}" in
*'"refused"'*'is not on screen'*) SHOT_OK=1 ;;
*) SHOT_OK=0 ;;
esac

echo "opened: $OPENED, window $WINDOW"
echo "pressed: $PRESSED"
echo "typed: ${TYPED_A:-} ${TYPED_B:-}"
echo "screenshot: ${SHOT:-}"
echo "shell=$SAW_SHELL page=$SAW_PAGE hide=$SAW_HIDE press=$SAW_PRESS typed=$SAW_TYPED hidden-while-held=${HIDDEN_WHILE_HELD:-} screenshot=$SHOT_OK hidden-at-end=$SAW_LET_GO"
grep -F "guest-visibility" "$ENGINE_LOG" | tail -4

FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the module did not load, or it threw"
elif [ -z "$WINDOW" ] || [ "$SAW_PAGE" != "1" ]; then
  FAILURE="no browser window loaded the page (open_url answered $OPENED), so nothing was driven"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the agent's press never reached the page (answered $PRESSED), so its keyboard is not there"
elif [ "$SAW_HIDE" != "1" ]; then
  FAILURE="the shell never hid the window: its field did not take the text \"hide\""
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_LET_GO" = "1" ]; then
    PASSED="the control is sharp: with no agent's keyboard in it, the hidden window's page is hidden, so the positive run's shown page is the agent's doing"
  else
    FAILURE="the shell's hide hid nothing: with no agent in the window its page never went hidden, so the positive run proves nothing"
  fi
elif [ "$HIDDEN_WHILE_HELD" = "1" ]; then
  FAILURE="THE AGENT'S WINDOW WENT HIDDEN WHILE ITS KEYBOARD WAS IN IT: a window on a workspace nobody watches stops running its page's frames and timers, and the agent's work there stalls"
elif [ "$SAW_TYPED" != "1" ]; then
  FAILURE="the agent's keys a and b did not reach the hidden window's field as \"ab\" (answered ${TYPED_A:-} ${TYPED_B:-})"
elif [ "$SHOT_OK" != "1" ]; then
  FAILURE="the agent's screenshot of the hidden window was not refused as off screen: ${SHOT:-}"
elif [ "$SAW_LET_GO" != "1" ]; then
  FAILURE="the hidden window's page stayed shown after the agent's keyboard left it: it runs as shown for nobody"
else
  PASSED="an agent's hidden window ran as shown while its keyboard was in it: the keys reached the page, a screenshot was refused as off screen at once, and the page hid once the keyboard left"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi
annotate_from "guard-agent-hidden-window: $FAILURE" "$ENGINE_LOG"
echo "guard-agent-hidden-window: $FAILURE" >&2
echo "the compositor stand-in's log:" >&2
tail -30 "$SOCKET_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
