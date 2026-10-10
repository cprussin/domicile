#!/usr/bin/env bash
# A browser window drawn in a `<webview>` that is not rendered is hidden, like
# a background tab, and shown again when its view is.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-hidden.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the page's `document.visibilityState` from the browser's log, so it needs no
# pixels and no client.
#
# Why: manganese keeps every browser window mounted and hides the ones on other
# workspaces with `display: none`. Their pages must throttle. The element's
# frame tells the browser whether it is rendered
# (`RemoteFrameView::VisibilityChanged`), and content hides or shows the
# attached page from that (`WebContentsImpl::OnRenderFrameProxyVisibilityChanged`).
# `WebViewGuest::AttachWindowTo` shows the page on attach, capped by that
# visibility.
#
# The shell draws one browser window in a box that starts `display: none`,
# shows the box once the window is attached, then hides it again. Asserted:
#
#   the shell page ran            or nothing was set up
#   the page loaded               a window was opened and navigated
#   the shell showed and hid it   the <webview> reported its page, so it was
#                                 attached, and both steps ran
#   hidden while not rendered     the page's last state before the box was
#                                 shown is `hidden`
#   visible when shown            its state when the box was hidden again is
#                                 `visible`: it was shown and stayed so
#   hidden again                  its last state is `hidden`
#
# Control: NEGATIVE=1 starts the box shown. The page's last state before the
# shell's `showing` step must be `visible`, so the claim's `hidden` is the
# box's doing, not a headless browser's.
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
  annotate "guard-webview-hidden: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 starts the box shown. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="hidden"
HIDE=1
[ "$NEGATIVE" = "1" ] && MODE="shown" && HIDE=0

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-hidden$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-hidden$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-hidden$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-hidden$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
# The shell's window. Without a size the headless window's viewport is empty,
# so a shown <webview> is out of it and its page is occluded, which reads
# `hidden` too.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# How long the shell waits between attaching, showing and hiding, so each
# visibility change has landed before the next step.
SETTLE_MS="${SETTLE_MS:-3000}"
# How long to wait after the shell hides the box, for the page to say so.
SETTLE_SECONDS="${SETTLE_SECONDS:-3}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-hidden: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-hidden: no python3, which serves the page"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page, on its own server like every <webview> guard's: `crux` reaches
#    no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-hidden-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-hidden: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-hidden: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"

# 2. The engine. `src` goes last: it is a URL.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?hide=$HIDE&settle=$SETTLE_MS&src=$SUBJECT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-hidden.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 3. Wait for the shell to show and hide the box, then for the page to answer.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD hiding" "$ENGINE_LOG" ||
  echo "the shell never hid the box; the verdict below says what that means" >&2
sleep "$SETTLE_SECONDS"

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# The page's states at the shell's steps: its state when the box was shown,
# whether it was visible when the box was hidden again, and its state at the
# end. A page reports only changes, so each is the last state before that
# point. `none` when there was no state or no such step.
STATES="$(awk '
  match($0, /GUARD state=[a-z]+/) {
    state = substr($0, RSTART + 12, RLENGTH - 12)
  }
  /GUARD showing/ { showed = 1; before = state }
  /GUARD hiding/ { hid = 1; shown = (state == "visible") }
  END {
    if (!showed) { before = state }
    after = (hid ? state : "")
    printf "%s %d %s\n", (before == "" ? "none" : before), shown,
      (after == "" ? "none" : after)
  }' "$ENGINE_LOG" 2>/dev/null)"

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_STEPS=0
[ "$(saw "GUARD showing")" = "1" ] && [ "$(saw "GUARD hiding")" = "1" ] && SAW_STEPS=1

MEASURED="$MODE $SAW_SHELL $SAW_PAGE $SAW_STEPS $STATES"
echo
echo "measured: $MEASURED"
echo "  (mode shell page steps before-showing visible-at-hiding last)"

# Which end to blame. `scripts/test-webview-hidden-guard.sh` runs this block
# directly. MEASURED is "<mode> <shell> <page> <steps> <before> <shown>
# <after>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"hidden 1 1 1 hidden 1 hidden")
  PASSED="a browser window's page is hidden while its <webview> is not \
rendered, visible once it is, and hidden again when it is not"
  ;;
"shown 1 1 1 visible "*)
  PASSED="the control is sharp: the same window in a box shown from the start \
was visible, so the claim's hidden page is the box's doing"
  ;;
"hidden 0 "* | "shown 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"hidden 1 0 "* | "shown 1 0 "*)
  FAILURE="the page never loaded: openBrowserWindow opened no window \
('opened browser window' in the log) or the list never reached the shell"
  ;;
"hidden 1 1 0 "* | "shown 1 1 0 "*)
  FAILURE="the shell never showed and hid the box, because its <webview> \
never reported a page: the window was not attached (AttachToElement, \
AttachWindowTo, ReportEverything)"
  ;;
"hidden 1 1 1 visible "*)
  FAILURE="A PAGE WHOSE <webview> IS NOT RENDERED SAYS IT IS VISIBLE, so it \
runs unthrottled: the element's frame visibility never reached the guest \
(RemoteFrameView::VisibilityChanged, CrossProcessFrameConnector, \
WebContentsImpl::OnRenderFrameProxyVisibilityChanged), or something showed the \
page after it"
  ;;
"hidden 1 1 1 hidden 0 "*)
  FAILURE="the page was not visible when the box was hidden again: nothing \
showed the guest when its <webview> was rendered, or its <webview> was out of \
the shell's viewport, so the guest was occluded (kRenderedOutOfViewport, \
WasOccluded) -- the shell logs its viewport at its showing step"
  ;;
"hidden 1 1 1 hidden 1 "*)
  FAILURE="the box was hidden again and the page did not say hidden: the \
guest kept running after its <webview> stopped being rendered"
  ;;
"shown 1 1 1 "*)
  FAILURE="the control's page, in a box shown from the start, was not visible \
before the shell's showing step, so the claim's hidden page says nothing about \
the box"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the page never said its state, or the run did not get as far as reading"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-hidden: $FAILURE" "$ENGINE_LOG"
echo "the page's states and the shell's steps, in order:" >&2
grep -E "GUARD (state=|showing|hiding|attached)" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
