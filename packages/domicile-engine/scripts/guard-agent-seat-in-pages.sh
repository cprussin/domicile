#!/usr/bin/env bash
# An agent seat's pointer and keys reach a browser window at a desk position.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-agent-seat-in-pages.sh /build/chromium/src
#
# The shell (guard-agent-input-keeps-focus.js) has the user's text field
# focused in a strip, and draws a browser window under it whose page is one
# text field (guard-agent-input-keeps-focus-page.py). A stand-in compositor
# (guard-agent-seat-in-pages-compositor.py) sends the browser what the
# compositor sends for an agent seat over the pages: `agent_input` with a
# pointer at a desk point in the window, a press and release, and the keys
# `a` and `b`. It asserts:
#
#   reached     the browser answered each ask with the window's id
#   typed       the page's field has "ab"
#   kept        the user's field is still the shell's activeElement
#   untouched   nothing was typed into the user's field
#   shell       a press at a point in the shell's strip is refused, since
#               agents act on the shell by ref
#
# Control: NEGATIVE=1 sends the same asks with the window barred, as the
# compositor does when the user took it over. Each must be refused and the
# page must get nothing, so the positive run's text is the agent seat's and
# not something else reaching the page.
#
# Headless, with no real compositor or client. See patch 0277.
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
  annotate "guard-agent-seat-in-pages: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-agent-seat-in-pages$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-agent-seat-in-pages$WHICH-command}"
CONTROL="${CONTROL:-/tmp/domicile-agent-seat-in-pages$WHICH-control}"
DRIVE="${DRIVE:-/tmp/domicile-agent-seat-in-pages$WHICH-drive}"
PROFILE="${PROFILE:-/tmp/domicile-agent-seat-in-pages$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-agent-seat-in-pages$WHICH-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-agent-seat-in-pages$WHICH-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-agent-seat-in-pages$WHICH-http.log}"
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
# evdev codes, from linux/input-event-codes.h.
BTN_LEFT=272
KEY_A=30
KEY_B=48

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
  annotate "guard-agent-seat-in-pages: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-agent-seat-in-pages: no python3, and the page and the compositor are both stood in by one"
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
  annotate_from "guard-agent-seat-in-pages: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-agent-seat-in-pages: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# 2. The compositor's end of the control socket.
python3 "$SCRIPTS/guard-agent-seat-in-pages-compositor.py" \
  --socket "$CONTROL" --drive "$DRIVE" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "driving on" "$SOCKET_LOG" || {
  annotate_from "guard-agent-seat-in-pages: the compositor stand-in never listened" "$SOCKET_LOG"
  exit 1
}

# 3. The engine, with the user's field focused.
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
WINDOW="$(sed -n 's/.*GUARD window id=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
# Hit testing uses submitted compositor frames, and the page's first frame may
# lag its load.
sleep 3

# 5. The agent seat: a press in the page, then two keys. The control bars the
# window, as the compositor does once the user takes it over.
BARRED="[]"
[ "$NEGATIVE" = "1" ] && BARRED="[\"$WINDOW\"]"
POINTED="$(agent "{\"kind\":\"pointer\",\"x\":$DESK_X,\"y\":$DESK_Y}" "$BARRED")"
PRESSED="$(agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":true}" "$BARRED")"
agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":false}" "$BARRED" >/dev/null
TYPED_A="$(agent "{\"kind\":\"key\",\"keycode\":$KEY_A,\"pressed\":true}" "$BARRED")"
agent "{\"kind\":\"key\",\"keycode\":$KEY_A,\"pressed\":false}" "$BARRED" >/dev/null
TYPED_B="$(agent "{\"kind\":\"key\",\"keycode\":$KEY_B,\"pressed\":true}" "$BARRED")"
agent "{\"kind\":\"key\",\"keycode\":$KEY_B,\"pressed\":false}" "$BARRED" >/dev/null

# The answers come before the page handles the events. The positive run waits
# for its text; the control gives text, which must not come, time to show.
if [ "$NEGATIVE" = "1" ]; then
  sleep 3
else
  wait_for_line 40 "GUARD guest-input value=ab" "$ENGINE_LOG"
fi

# 6. A press in the shell's strip, which the agent seat must not reach.
SHELL_POINTED="$(agent "{\"kind\":\"pointer\",\"x\":$DESK_X,\"y\":$((STRIP_HEIGHT / 2))}")"
SHELL_PRESSED="$(agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":true}")"
agent "{\"kind\":\"button\",\"button\":$BTN_LEFT,\"pressed\":false}" >/dev/null
sleep 1

# The shell's last activeElement, as its module reports it.
ACTIVE="$(sed -n 's/.*GUARD active=\([^" ]*\).*/\1/p' "$ENGINE_LOG" | tail -1)"

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
# Whether answer $1 names the window, without a refusal.
reached() { # $1 answer
  case "$1" in
  *'"refused"'*) echo 0 ;;
  *"\"window\":\"$WINDOW\""*) echo 1 ;;
  *) echo 0 ;;
  esac
}
# Whether answer $1 refuses with text $2.
refused() { # $1 answer, $2 text
  case "$1" in
  *"\"refused\":\"$2"*) echo 1 ;;
  *) echo 0 ;;
  esac
}
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_PRESS=$(saw "GUARD guest-mousedown")
SAW_TYPED=$(saw "GUARD guest-input value=ab")
SAW_ANY_TYPED=$(saw "GUARD guest-input")
SAW_USER_INPUT=$(saw "GUARD user-input")
SAW_REACHED=$(saw "GUARD window-reached")
REACHED_ALL=0
[ "$(reached "$POINTED")$(reached "$PRESSED")$(reached "$TYPED_A")$(reached "$TYPED_B")" = "1111" ] && REACHED_ALL=1
BARRED_ALL=0
# With nothing pressed, the keys are refused for having no window to go to.
[ "$(refused "$POINTED" "the user took over")$(refused "$PRESSED" "the user took over")$(refused "$TYPED_B" "")" = "111" ] && BARRED_ALL=1
SHELL_REFUSED=$(refused "$SHELL_PRESSED" "the shell is at that point")
case "$ACTIVE" in
user) KEPT=1 ;;
*) KEPT=0 ;;
esac

echo "opened: $OPENED, window $WINDOW"
echo "pointed: $POINTED"
echo "pressed: $PRESSED"
echo "typed: $TYPED_A $TYPED_B"
echo "at the shell: $SHELL_POINTED / $SHELL_PRESSED"
echo "shell's activeElement: ${ACTIVE:0:200}"
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_PRESS typed=$SAW_TYPED any-typed=$SAW_ANY_TYPED"
echo "the shell heard: reached=$SAW_REACHED user-input=$SAW_USER_INPUT kept=$KEPT"
grep -F "GUARD guest-input" "$ENGINE_LOG" | tail -3

FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the module did not load, or it threw"
elif [ -z "$WINDOW" ] || [ "$SAW_PAGE" != "1" ]; then
  FAILURE="no browser window loaded the page (open_url answered $OPENED), so nothing was driven"
elif ! grep -qF '"type": "agent_input_reached"' "$SOCKET_LOG" && ! grep -qF '"type":"agent_input_reached"' "$SOCKET_LOG"; then
  FAILURE="the browser never answered an agent_input (pointed: $POINTED): the control channel has no agent_input arm, or no sink"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$BARRED_ALL" = "1" ] && [ "$SAW_ANY_TYPED" = "0" ] && [ "$SAW_PRESS" = "0" ]; then
    PASSED="the control is sharp: with the window barred each ask is refused and the page gets nothing, so the positive run's text is the agent seat's"
  else
    FAILURE="AN AGENT REACHED A WINDOW THE USER TOOK OVER: barred asks were answered $POINTED / $PRESSED / $TYPED_B, and the page saw press=$SAW_PRESS input=$SAW_ANY_TYPED"
  fi
elif [ "$REACHED_ALL" != "1" ]; then
  FAILURE="the browser did not answer each ask with window $WINDOW: pointed $POINTED, pressed $PRESSED, typed $TYPED_A $TYPED_B"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the agent's press at desk ($DESK_X, $DESK_Y) never reached the browser window's page: the desk point was not hit tested into the guest, or not converted to its coordinates"
elif [ "$SAW_TYPED" != "1" ]; then
  FAILURE="the agent's keys a and b did not reach the page's field as \"ab\": the key widget was wrong, or the evdev codes did not map to characters"
elif [ "$SAW_USER_INPUT" = "1" ]; then
  FAILURE="THE AGENT TYPED INTO THE USER'S FIELD"
elif [ "$SAW_REACHED" = "1" ] || [ "$KEPT" != "1" ]; then
  FAILURE="THE AGENT'S PRESS MOVED THE USER'S FOCUS: reached=$SAW_REACHED, the shell's activeElement is ${ACTIVE:0:120}"
elif [ "$SHELL_REFUSED" != "1" ]; then
  FAILURE="THE AGENT'S PRESS REACHED THE SHELL: a press in the strip was answered $SHELL_PRESSED, not refused"
else
  PASSED="the agent seat pressed and typed in a browser window at a desk position, the user's field kept the focus and got nothing, and a press on the shell was refused"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi
annotate_from "guard-agent-seat-in-pages: $FAILURE" "$ENGINE_LOG"
echo "guard-agent-seat-in-pages: $FAILURE" >&2
echo "the compositor stand-in's log:" >&2
tail -30 "$SOCKET_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
