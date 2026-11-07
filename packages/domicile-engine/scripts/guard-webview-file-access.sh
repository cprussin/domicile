#!/usr/bin/env bash
# Checks that a page in a browser window asking to edit a file it opened asks
# the shell instead of Chrome's dialog, and that the shell's yes lets the
# page write it (patch 0179). See packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-file-access.sh /build/chromium/src
#
# Runs headless: nothing here is measured in pixels.
#
# Chrome asks for File System Access permissions with a prompt drawn on the
# outermost WebContents' window, which for a guest is the shell's; and a
# guest has no prompt manager, so the request was refused outright. Patch
# 0179's SetDomicilePrompts sends it to the element as PromptRequested, and
# the element fires `domicile-prompt`.
#
# The page (guard-webview-file-chooser-server.py's /edit) opens a file with
# showOpenFilePicker() on one press, which the shell answers, and writes to it
# on a second, which asks to edit it. Two presses, because each step needs a
# user gesture of its own.
#
# Checks, in order:
#
#   the shell page ran
#   a press reached the shell's        the harness can deliver a click
#     document
#   the page in the window ran         a guest was made, attached and navigated
#   the page opened the file           the shell answered its picker
#   the browser asked the shell        the override ran in place of Chrome's
#                                      prompt
#   the shell heard it                 `domicile-prompt` reached it, as
#                                      file-edit for the file's name
#   the shell answered                 its answer did not throw
#   the browser got the answer         WebViewGuest logged it
#   the file holds the page's text     the main claim
#
# NEGATIVE=1 is the control: the shell says no. The page must be refused
# (NotAllowedError) and the file must keep its old text.
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
  annotate "guard-webview-file-access: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-file-access-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-file-access-profile}"
HOME_DIR="${HOME_DIR:-/tmp/domicile-webview-file-access-home}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# Not `STRIP`, which the build shell exports as a program. See
# guard-webview-new-window.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The center of the guest, which the button fills.
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

FOR_SECONDS="${FOR_SECONDS:-90}"

# The file the shell picks, what it holds, and what the page writes
# (EDIT_TEXT in guard-webview-file-chooser-server.py).
PICK="notes/guard-edit.txt"
NAME="guard-edit.txt"
BEFORE="a file before any page edited it"
TEXT="a file a page edited once the shell allowed it"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-file-access$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-file-access$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-file-access$WHICH-mouse.log}"

PROMPT="accept"
[ "$NEGATIVE" = "1" ] && PROMPT="dismiss"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -rf "$HOME_DIR"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-file-access: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-file-access: no python3, and the page in the window and the click are both driven by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE" "$HOME_DIR"; mkdir -p "$PROFILE"
mkdir -p "$HOME_DIR/$(dirname "$PICK")"
printf '%s' "$BEFORE" >"$HOME_DIR/$PICK"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page in the window.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-file-chooser-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-file-access: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-file-access: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"

# 2. The engine, on a domicile:// document, with this guard's home.
rm -f "$ENGINE_LOG"
HOME="$HOME_DIR" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/edit&answer=choose&pick=$PICK&prompt=$PROMPT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-file-chooser.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-file-access: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-file-access: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. A page in the window, and a settle for its first frame.
wait_for_line "$TRIES" "GUARD edit-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep 3

# 4. A press on the shell's strip, to show clicks arrive.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2
wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. The first press on the button: the page opens the file, which the shell
#    picks. A real click, because showOpenFilePicker() requires a user gesture.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the first click into the window could not be driven; see $CLICK_LOG" >&2
wait_for_line "$TRIES" "GUARD opened name=" "$ENGINE_LOG" ||
  echo "the page never opened the file" >&2

# 6. The press under test: the page writes, which asks to edit the file.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the second click into the window could not be driven; see $CLICK_LOG" >&2

# A fixed wait, because the control's readings are absences. Long enough for
# the question, the answer and the write.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD edit-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
SAW_OPENED=$(saw "GUARD opened name=$NAME")
# Logged by WebViewGuest::AskPrompt. Separates "Chrome never asked the shell"
# from "it asked and the element did not fire".
SAW_ASKED=$(saw "domicile: a <webview> needs an answer to a ")
SAW_HEARD=$(saw "GUARD prompt kind=file-edit origin=$SITE subject=$NAME details=$HOME_DIR/$PICK")
SAW_ANSWERED=$(saw "GUARD prompt-answered")
SAW_YES=$(saw "domicile: a <webview>'s prompt was answered: yes.")
SAW_NO=$(saw "domicile: a <webview>'s prompt was answered: no.")
SAW_EDITED=$(saw "GUARD edited name=$NAME")
SAW_REFUSED=$(saw "GUARD edit-refused NotAllowedError")
NOW="$(cat "$HOME_DIR/$PICK" 2>/dev/null)"
WRITTEN=$([ "$NOW" = "$TEXT" ] && echo 1 || echo 0)
KEPT=$([ "$NOW" = "$BEFORE" ] && echo 1 || echo 0)
SAW_SETTLED=$SAW_YES
[ "$NEGATIVE" = "1" ] && SAW_SETTLED=$SAW_NO

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_CHROME guest=$SAW_GUEST opened=$SAW_OPENED"
echo "prompt: asked=$SAW_ASKED heard=$SAW_HEARD answered=$SAW_ANSWERED settled=$SAW_SETTLED"
echo "the page: edited=$SAW_EDITED refused=$SAW_REFUSED; the file: written=$WRITTEN kept=$KEPT"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-file-access-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so every reading \
below is about a desktop nobody touched. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no button to press. \
That is the guest: not made, not attached, or not navigated"
elif [ "$SAW_GUEST" != "1" ]; then
  FAILURE="the press never reached the page in the window. That is this \
harness or the element's box rather than anything about prompts"
elif [ "$SAW_OPENED" != "1" ]; then
  FAILURE="the page never opened the file, so it never had one to edit. That \
is the shell's file picker, which guard-webview-save-picker.sh covers"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE BROWSER NEVER ASKED THE SHELL: the page wrote to the file it \
opened and no prompt reached WebViewGuest. Patch 0179's SetDomicilePrompts was \
not set (UseTheShellForPrompts), or PermissionGrantImpl found a request \
manager, or refused before asking (the page needs a fresh user gesture)"
elif [ "$SAW_HEARD" != "1" ]; then
  FAILURE="the browser asked and the shell never heard it as file-edit for \
$NAME. PromptRequested did not reach the element, or the element did not fire \
domicile-prompt with the kind, the site, the name and the path"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell heard the prompt and its answer threw. The engine log has \
the shell's console"
elif [ "$SAW_SETTLED" != "1" ]; then
  FAILURE="the shell answered and the browser never logged that answer. The \
reply did not reach WebViewGuest::AskPrompt"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$KEPT" != "1" ]; then
    FAILURE="THE CONTROL WROTE THE FILE: the shell said no and the file \
changed anyway, so the positive run's write is not the shell's answer being \
followed"
  elif [ "$SAW_REFUSED" != "1" ]; then
    FAILURE="THE NO NEVER REACHED THE PAGE: the shell said no and the page \
was not refused. That is AskFileAccess's answer to PermissionGrantImpl"
  else
    PASSED="the control is sharp: the shell said no, the page was refused, \
and the file kept its text. So what the positive run reads is the shell's \
answer"
  fi
elif [ "$WRITTEN" = "1" ]; then
  PASSED="a page in a browser window asked to edit a file it opened, the \
shell was asked in place of Chrome's prompt, and its yes let the page write it"
else
  FAILURE="the shell said yes and the file does not hold the page's text. \
PermissionGrantImpl did not grant on GRANTED, or the page's write failed, \
which it says as edit-refused"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-file-access: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
