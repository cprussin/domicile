#!/usr/bin/env bash
# Checks that a page in a browser window asking for the camera asks the shell,
# and that the shell's answer reaches the page and is stored for the site.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-permissions.sh /build/chromium/src
#
# Runs under a nested Wayland compositor (under-wayland.sh), with Chromium's
# fake camera. Not headless: PermissionRequestManager::AddRequest denies every
# request on a headless screen before any prompt. The page calls getUserMedia
# on load. The guest's prompt (//chrome/browser/domicile/domicile_permissions.h)
# dispatches `domicile-permission-request` on the element, and the shell
# allows.
#
# Asserts, in order (each step depends on the previous one):
#
#   the shell page ran
#   the page in the window ran         a guest was created and navigated
#   the browser was asked              WebViewGuest::AskPermission ran
#   the shell was asked                the event reached the element, naming
#                                      the camera
#   the shell answered                 its answer did not throw
#   the page got the camera            the assertion: getUserMedia resolved
#   the site's camera is "allow"       the answer was stored and reported
#
# Unit tests cannot check this: happy-dom has no guest and no browser to grant
# a camera.
#
# NEGATIVE=1 runs the control: the shell denies, and the page must be refused
# and the site's camera stored as "block". This shows the page gets the
# shell's answer rather than a fixed one.
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
  annotate "guard-webview-permissions: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-permissions-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-permissions-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

FOR_SECONDS="${FOR_SECONDS:-90}"

WHICH=""
ANSWER="allow"
STORED="allow"
if [ "$NEGATIVE" = "1" ]; then
  WHICH="-negative"
  ANSWER="deny"
  STORED="block"
fi
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-permissions$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-permissions$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-permissions: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-permissions: no python3, and the page in the window is served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page in the window.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-permissions-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-permissions: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-permissions: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"

# 2. The engine, on a domicile:// document, with a fake camera and no fake
#    prompt: `--use-fake-ui-for-media-stream` would answer for the shell.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --disable-gpu \
  --use-fake-device-for-media-stream \
  --app="domicile://shell/?src=$SITE/camera&answer=$ANSWER" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-permissions.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-permissions: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  exit 1
}
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
# The page's answer, either way, then a moment for the settings report.
heard_back() {
  for _ in $(seq 1 "$TRIES"); do
    grep -qE "GUARD page-(granted|refused)" "$ENGINE_LOG" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}
heard_back || echo "the page never heard back about the camera" >&2
sleep 2

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")
# Logged by WebViewGuest::AskPermission. Tells "no prompt was made" apart from
# "the shell was never told".
SAW_BROWSER=$(saw "domicile: a <webview>'s page asked for a permission; asking the shell.")
SAW_ASKED=$(saw "GUARD permission-request origin=$SITE permissions=camera")
SAW_ANSWERED=$(saw "GUARD answered")
SAW_GRANTED=$(saw "GUARD page-granted tracks=1")
SAW_REFUSED=$(saw "GUARD page-refused name=NotAllowedError")
SAW_STORED=$(saw "GUARD site-permissions camera=$STORED")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the browser was asked=$SAW_BROWSER; the shell was asked=$SAW_ASKED and answered=$SAW_ANSWERED ($ANSWER)"
echo "the page got: the camera=$SAW_GRANTED refused=$SAW_REFUSED; the site's camera is $STORED=$SAW_STORED"
echo

# Map the readings to a verdict. `scripts/test-webview-permissions-guard.sh`
# runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so nothing asked for the \
camera. That is the guest: not made, not attached, or not navigated"
elif [ "$SAW_BROWSER" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: the page asked for the camera and no \
prompt reached WebViewGuest::AskPermission. That is the guest's \
RequestMediaAccessPermission and MediaAccess, its PermissionRequestManager, \
or the prompt factory AttachPermissionPrompts sets"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE BROWSER WAS ASKED AND THE SHELL WAS NOT: AskPermission ran and \
no domicile-permission-request naming this site's camera reached this \
document. That is PermissionRequested on WebViewGuestClient, the dispatch in \
HTMLWebViewElement, or the event's name, of which \
WEBVIEW_PERMISSION_REQUEST_EVENT in the SDK is the third copy"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell was asked and its answer threw: this guard's page called \
allow() or deny() and never got past it. The engine log has the exception"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_GRANTED" = "1" ]; then
    FAILURE="THE CONTROL GOT THE CAMERA: the shell denied and the page was \
handed a stream anyway, so what the positive run reads is not the shell's \
answer"
  elif [ "$SAW_REFUSED" != "1" ]; then
    FAILURE="the shell denied and the page never heard: getUserMedia neither \
resolved nor was refused. ShellPermissionPrompt::Decide in \
domicile_permissions.cc is where the answer goes back to Chrome"
  elif [ "$SAW_STORED" != "1" ]; then
    FAILURE="the page was refused but the site's camera was never reported \
as blocked: the deny was not stored, or SitePermissionsChanged did not \
report it"
  else
    PASSED="the control is sharp: the shell denied, the page was refused, and \
the site's camera is blocked. So what the positive run reads is the shell's \
answer"
  fi
elif [ "$SAW_GRANTED" != "1" ]; then
  if [ "$SAW_REFUSED" = "1" ]; then
    FAILURE="THE ALLOW BECAME A REFUSAL: the shell allowed and the page was \
refused the camera. The answer was read as something else on the way back -- \
ShellPermissionPrompt::Decide -- or the media path refused after the grant"
  else
    FAILURE="the shell allowed and the page heard nothing at all: \
getUserMedia neither resolved nor was refused. Chrome's media handler never \
finished the request"
  fi
elif [ "$SAW_STORED" != "1" ]; then
  FAILURE="the page got the camera but the site's camera was never reported \
as allowed: the grant was not stored, or SitePermissionsChanged and the \
element's sitePermissions() did not report it"
else
  PASSED="a page in a browser window asked for the camera, the shell was \
asked and allowed, the page got the stream, and the site's camera reads \
allowed"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-permissions: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
