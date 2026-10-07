#!/usr/bin/env bash
# Checks that clicking an `<input type="file">` in a browser window asks the
# shell, and that the file the shell picks reaches the page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-upload.sh /build/chromium/src
#
# Runs headless. The guest's RunFileChooser dispatches `domicile-file-chooser`
# on the element. The shell answers with an absolute path.
#
# Asserts, in order (each step depends on the previous one):
#
#   the shell page ran
#   a press reached the shell's        the harness can deliver clicks
#     document
#   the page in the window ran         a guest was created and navigated
#   the press landed in the guest      on the input, which fills the page
#   the browser was asked              WebViewGuest::RunFileChooser ran
#   the shell was asked                the event reached the element
#   the shell answered                 its answer did not throw
#   the page read the file             the assertion: name and contents; a
#                                      renderer can read the contents only if
#                                      the browser granted it the file
#
# Unit tests cannot check this: happy-dom has no guest and no browser to grant
# a file.
#
# NEGATIVE=1 runs the control: the shell cancels, and the page must get no
# file and must see the cancel event. This shows the page receives the shell's
# answer rather than a fixed file.
#
# `HOME` points at a directory this script creates, so the picked path never
# names a file on the machine.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-upload: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-upload-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-upload-profile}"
HOME_DIR="${HOME_DIR:-/tmp/domicile-webview-upload-home}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# Not `STRIP`: build shells export that as the strip program.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest, which the input fills.
WINDOW_X=$((WIDTH / 2))
WINDOW_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

FOR_SECONDS="${FOR_SECONDS:-90}"

# PICK is the absolute path the shell answers with. TEXT is the file's contents.
PICK="$HOME_DIR/picked/guard-upload.txt"
TEXT="a file the shell picked"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-upload$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-upload$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-upload$WHICH-mouse.log}"

ANSWER="choose"
[ "$NEGATIVE" = "1" ] && ANSWER="cancel"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE" "$HOME_DIR"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-upload: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-upload: no python3, and the page in the window and the click are both driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE" "$HOME_DIR"; mkdir -p "$PROFILE"
mkdir -p "$(dirname "$PICK")"
printf '%s' "$TEXT" >"$PICK"

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
  annotate_from "guard-webview-upload: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-upload: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"

# 2. The engine, on a domicile:// document, with this guard's home.
rm -f "$ENGINE_LOG"
HOME="$HOME_DIR" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/upload&answer=$ANSWER&pick=$PICK" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-file-chooser.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-upload: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-upload: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. Wait for the guest page, then for its first frame: hit testing uses
#    frames, so a loaded page is not enough.
wait_for_line "$TRIES" "GUARD upload-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep 3

# 4. Click the shell's strip first. If that click arrives, a missing event
#    below means a real failure, not a broken harness.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2
wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. Click the input. It must be real input: a file input opens a chooser
#    only on a user gesture.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$WINDOW_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# A fixed wait: the control checks for events that must not arrive.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD upload-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
# Logged by WebViewGuest::RunFileChooser. Tells "no chooser opened" apart from
# "the shell was never told".
SAW_BROWSER=$(saw "domicile: a <webview>'s page asked for a file; asking the shell.")
SAW_ASKED=$(saw "GUARD file-chooser mode=open ")
SAW_ANSWERED=$(saw "GUARD answered")
# Matches the contents too: reading them proves the browser granted the
# renderer the file.
SAW_PICKED=$(saw "GUARD picked name=$(basename "$PICK") text=$TEXT")
SAW_ANY_PICK=$(saw "GUARD picked name=")
SAW_NOTHING=$(saw "GUARD picked-nothing")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE press=$SAW_CHROME guest=$SAW_GUEST"
echo "the browser was asked=$SAW_BROWSER; the shell was asked=$SAW_ASKED and answered=$SAW_ANSWERED"
echo "the page got: the file=$SAW_PICKED any file=$SAW_ANY_PICK nothing=$SAW_NOTHING"
echo

# Map the readings to a verdict. `scripts/test-webview-upload-guard.sh` runs
# this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so every reading \
below is about a desktop nobody touched. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no input to press. \
That is the guest: not made, not attached, or not navigated"
elif [ "$SAW_GUEST" != "1" ]; then
  FAILURE="the press never reached the page in the window. That is this \
harness or the element's box rather than anything about files"
elif [ "$SAW_BROWSER" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: a press landed on the input and \
WebViewGuest::RunFileChooser never ran. The input opened no chooser -- no user \
activation reached it, or content answered it somewhere other than this \
guest's delegate"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE BROWSER WAS ASKED AND THE SHELL WAS NOT: RunFileChooser ran \
and no domicile-file-chooser in open mode reached this document. That is \
FileChooserRequested on WebViewGuestClient, the dispatch in \
HTMLWebViewElement, or the event's name, of which WEBVIEW_FILE_CHOOSER_EVENT \
in the SDK is the third copy"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell was asked and its answer threw: this guard's page called \
choose() or cancel() and never got past it. The engine log has the exception"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY_PICK" = "1" ]; then
    FAILURE="THE CONTROL GOT A FILE: the shell canceled and the page was handed \
one anyway, so what the positive run reads is not the shell's answer"
  elif [ "$SAW_NOTHING" != "1" ]; then
    FAILURE="the shell canceled and the page never heard: no cancel event on \
the input. The cancel was lost between the element and the page's chooser -- \
FilesChosen in web_view_guest.cc is where a null answer becomes one"
  else
    PASSED="the control is sharp: the shell canceled, and the page got no file \
and heard the cancel. So what the positive run reads is the shell's answer"
  fi
elif [ "$SAW_PICKED" = "1" ]; then
  PASSED="an <input type=\"file\"> clicked inside a browser window asked the \
shell, which answered with an absolute path, and \
that file reached the page, which read its contents"
elif [ "$SAW_ANY_PICK" = "1" ]; then
  FAILURE="THE PAGE GOT THE WRONG FILE: a file arrived and it is not the one \
the shell picked, by name or by contents. The path is resolved in the \
browser -- see ResolvedPath in file_choice.h"
elif [ "$SAW_NOTHING" = "1" ]; then
  FAILURE="THE ANSWER BECAME A CANCEL: the shell chose a file and the page \
heard a cancel. The browser refused the answer -- a bad message, which the \
engine log names -- or read it as nothing"
else
  FAILURE="the shell answered and the page heard nothing at all: neither a \
file nor a cancel. The browser's listener was never told -- see FilesChosen \
in web_view_guest.cc"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-upload: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
exit 1
