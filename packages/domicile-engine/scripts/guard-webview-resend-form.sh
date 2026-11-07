#!/usr/bin/env bash
# Reloading a page a form posted to asks the shell whether to send the form
# again, and the shell's answer decides (patch 0181's WebViewGuest).
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-resend-form.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-click.sh: nothing here
# is measured in pixels, and nothing is pressed.
#
# Chrome asks "Confirm Form Resubmission" with a dialog of its own. A guest
# had no answer at all: content's default ShowRepostFormWarningDialog does
# nothing, so the reload never happened. WebViewGuest now asks the shell with
# PromptRequested, as resend-form, and continues or cancels the reload.
#
# The pages are guard-webview-resend-form-server.py's: /form posts itself to
# /posted as it loads, and the shell then reloads /posted once.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   the form was posted              the guest was made, attached and
#                                     navigated, and the form sent
#   the shell reloaded               the posted page loaded and the element
#                                     said so
#   the browser asked the shell      WebViewGuest logged the prompt
#   the shell heard it               as resend-form, titled "Order placed"
#   the browser got the answer       WebViewGuest logged it
#   the form was posted again        the main claim
#
# NEGATIVE=1 is the control: the shell says no. The form must be posted once
# only, or the positive run's second post could come from the reload alone.
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
  annotate "guard-webview-resend-form: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-resend-form-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-resend-form-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Height of the shell's strip in CSS pixels.
#
# Not `STRIP`: `nix develop .#full` exports `STRIP=strip`. See
# guard-webview-external-app.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"

# Time for the shell to load and its guest to attach and navigate, and for
# each report the positive run waits on.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-resend-form$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-resend-form$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-resend-form: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-resend-form: no python3, and the page in the window is served by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages: one local server, because `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-resend-form-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-resend-form: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-resend-form: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
PROMPT="accept"
[ "$NEGATIVE" = "1" ] && PROMPT="dismiss"
WALK="src=$SITE/form&prompt=$PROMPT"
echo "walking $WALK"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&$WALK" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-resend-form.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-resend-form: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# Mojo prints the kind with or without its enum name before it.
ASKED_LINE="kResendForm prompt; asking the shell."
ANSWERED_LINE="domicile: a <webview>'s prompt was answered: "

# 3. The post, the reload and the answer.
wait_for_line "$TRIES" "GUARD reloading" "$ENGINE_LOG" ||
  echo "the shell never reloaded" >&2
wait_for_line "$TRIES" "GUARD prompt-answered" "$ENGINE_LOG" ||
  echo "the shell never answered a prompt" >&2
# A settle for the second post, or in the control for one that must not come.
sleep 3

saw() { # $1 pattern, $2 file
  grep -qF "$1" "${2:-$ENGINE_LOG}" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_POSTED=$(saw "posted 1" "$HTTP_LOG")
SAW_RELOADING=$(saw "GUARD reloading")
SAW_ASKED=$(saw "$ASKED_LINE")
SAW_HEARD=$(saw "GUARD prompt kind=resend-form origin=$SITE subject=Order placed")
SAW_ANSWERED=$(saw "$ANSWERED_LINE")
SAW_POSTED_AGAIN=$(saw "posted 2" "$HTTP_LOG")

echo
echo "shell=$SAW_SHELL posted=$SAW_POSTED reloading=$SAW_RELOADING"
echo "prompt: asked=$SAW_ASKED heard=$SAW_HEARD answered=$SAW_ANSWERED"
echo "posted again=$SAW_POSTED_AGAIN"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `packages/domicile-engine/tests/test-webview-resend-form-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up. This is the \
harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_POSTED" != "1" ]; then
  FAILURE="the form was never posted. That is the guest: it was not made, \
attached or navigated, or the page's script never ran"
elif [ "$SAW_RELOADING" != "1" ]; then
  FAILURE="the form was posted and the shell never reloaded the page. The \
element never said the posted page finished loading: \
domicile-loading-change, loading or url"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="the shell reloaded a posted page and the browser never asked it. \
WebViewGuest::ShowRepostFormWarningDialog did not run: content did not check \
for a repost, or the override is gone"
elif [ "$SAW_HEARD" != "1" ]; then
  FAILURE="the browser asked and the shell never heard it as resend-form for \
the page's title. PromptRequested did not reach the element, or \
DomicilePromptEvent named it wrong"
elif [ "$SAW_ANSWERED" != "1" ]; then
  FAILURE="the shell heard the prompt and the browser never got the answer. \
The element's answer did not reach AskPrompt's callback"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_POSTED_AGAIN" = "1" ]; then
    FAILURE="the shell said no and the form was sent again anyway, so the \
positive run's second post may come from the reload alone. \
CancelPendingReload did not stop it"
  else
    PASSED="the control is sharp: the shell's no kept the form from being \
sent again"
  fi
elif [ "$SAW_POSTED_AGAIN" != "1" ]; then
  FAILURE="the shell said yes and the form was never sent again. \
ContinuePendingReload did not run, or a navigation replaced the reload"
else
  PASSED="reloading a posted page asked the shell, in place of Chrome's \
dialog, and the shell's yes sent the form again"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-resend-form: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the server said:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
