#!/usr/bin/env bash
# Checks that a page hidden while the desktop's theme turns is drawn in the
# new theme the first time it is shown, as when a person turns the desk dark
# and then switches to a tab behind another.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-hidden-theme.sh /build/chromium/src
#
# A <webview> with `display: none` hides its page, and a hidden page draws no
# frames. Its colors change with the theme, but the frame the desk embeds is
# the one it drew before it was hidden, in the old theme, until it draws again
# after it is shown. A hidden page whose colors change draws once while hidden
# (patch 0285).
#
# The compositor stand-in (guard-webview-hidden-theme-compositor.py) starts
# the desk light and turns it dark when asked. guard-webview-hidden-theme.py
# hides the window, turns the desk, shows the window and reads its first frame.
# Asserted:
#
#   the page drew    yellow, in the light scheme, before it was hidden
#   hidden           the page said it was hidden before the desk turned
#   drew hidden      the engine ended the hidden page's capture with its frame
#                    in the new colors, before the show
#   first frame      the first frame after the show is blue, the dark scheme
#   settled          the page is blue after the show
#
# Each step waits for the line that says the one before it happened, not for
# a while: on a busy machine the page can take seconds to restyle.
#
# Control: NEGATIVE=1 leaves the desk light, and the page turns its own scheme
# dark while hidden. Nothing paints that, so its first frame after the show
# must be the stale yellow one. This proves the first screenshot sees a stale
# frame.
#
# Headless and software-composited like the other <webview> guards.
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
  annotate "guard-webview-hidden-theme: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
WHICH=""
if [ "$NEGATIVE" = "1" ]; then
  MODE="control"
  WHICH="-negative"
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-webview-hidden-theme$WHICH-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-hidden-theme$WHICH-control.sock}"
TURN="${TURN:-/tmp/domicile-webview-hidden-theme$WHICH-turn}"
PROFILE="${PROFILE:-/tmp/domicile-webview-hidden-theme$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-hidden-theme$WHICH-engine.log}"
COMPOSITOR_LOG="${COMPOSITOR_LOG:-/tmp/domicile-webview-hidden-theme$WHICH-compositor.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-hidden-theme$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$TURN" "$CONTROL"
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-hidden-theme: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-hidden-theme: no python3, which serves the page and drives the shell"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
rm -f "$TURN"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

TRIES=$((FOR_SECONDS * 4))

# 1. The page, on its own server: `crux` reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-hidden-theme-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-hidden-theme: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-hidden-theme: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page%3Fmode=$MODE"

# 2. The compositor's end of the control socket.
rm -f "$COMPOSITOR_LOG"
python3 "$SCRIPTS/guard-webview-hidden-theme-compositor.py" \
  --socket "$CONTROL" --turn "$TURN" >"$COMPOSITOR_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening" "$COMPOSITOR_LOG" || {
  annotate_from "guard-webview-hidden-theme: its compositor stand-in never came up" "$COMPOSITOR_LOG"
  exit 1
}

# 3. The engine. `src` goes last: it is a URL.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=1000,800 \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-hidden-theme.js" \
  --domicile-control-socket="$CONTROL" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --vmodule=web_contents_impl=1,render_widget_host_view_child_frame=1,widget_base=1 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 4. Hide the window, turn the desk, show the window and read its frames.
MEASURED=""
if wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG"; then
  if DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")"; then
    MEASURED="$(python3 "$SCRIPTS/guard-webview-hidden-theme.py" \
      --port "$DEBUG_PORT" --turn "$TURN" --mode "$MODE" \
      --engine-log "$ENGINE_LOG" --tries "$((FOR_SECONDS * 2))")"
  else
    MEASURED="no-port"
  fi
fi

echo "measured: ${MEASURED:-never asked} ($MODE)"
# When the page heard the dark scheme: `hidden`, `visible`, or `never`.
HEARD="$(grep -oE "GUARD scheme=dark while [a-z]+" "$ENGINE_LOG" | head -1 | awk '{print $NF}')"
HEARD="${HEARD:-never}"
echo "the page heard the dark scheme: $HEARD"

# Which end to blame. `packages/domicile-engine/tests/test-webview-hidden-theme-guard.sh`
# runs this block directly with MODE and MEASURED set.
FAILURE=""
PASSED=""
case "$MEASURED" in
first=never)
  FAILURE="the page never drew yellow, before anything was hidden: \
openBrowserWindow opened no window, the <webview> never showed its page, or \
the desk's light theme never reached it"
  ;;
first=*\ settled=*)
  FIRST="${MEASURED#first=}"
  FIRST="${FIRST%% *}"
  SETTLED="${MEASURED##*settled=}"
  if [ "$SETTLED" != "dark" ]; then
    FAILURE="the page was never drawn dark after it was shown (last read \
$SETTLED): the dark theme never reached it, so the first frame says nothing"
  elif [ "$MODE" = "claim" ] && [ "$FIRST" != "dark" ]; then
    FAILURE="the page's first frame after it was shown was $FIRST, the theme \
it was hidden in, and it heard the dark scheme while ${HEARD:-never}: a hidden page \
did not draw its new colors while hidden \
(WebContentsImpl::HandleColorRelatedStateChanges and \
RenderWidgetHostViewChildFrame::CanBecomeVisible, patch 0285)"
  elif [ "$MODE" = "claim" ]; then
    PASSED="a page hidden while the theme turned was drawn in the new theme \
the first time it was shown"
  elif [ "$FIRST" = "light" ]; then
    PASSED="the control is sharp: a page that turned itself dark while \
hidden showed its stale light frame first"
  else
    FAILURE="the control's page turned itself dark while hidden, and its \
first frame was $FIRST, not the stale light one: the first screenshot waits \
for the page to draw, so the claim's dark first frame says nothing"
  fi
  ;;
first=hidden-never)
  FAILURE="the page never said it was hidden after its <webview>'s box was \
hidden, so nothing it drew after says anything about a hidden page"
  ;;
first=drawn-never)
  FAILURE="the desk turned dark while the page was hidden, and the engine \
never ended its capture with the page's frame in the new colors: a hidden \
page did not draw its new colors while hidden \
(WebContentsImpl::HandleColorRelatedStateChanges, \
DomicilePaintNewColorsWhileHidden and \
RenderWidgetHostViewChildFrame::CanBecomeVisible, patch 0285)"
  ;;
first=turned-never)
  FAILURE="the control's page never said it turned itself dark while \
hidden, so its first frame after the show says nothing"
  ;;
no-port)
  FAILURE="the engine never said which debugging port it took"
  ;;
*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-hidden-theme: $FAILURE" "$ENGINE_LOG"
echo "guard-webview-hidden-theme: $FAILURE" >&2
echo "the steps, in order:" >&2
grep -E "GUARD (hiding|showing|scheme=|while hidden|turned itself)|domicile: .*(colors|embedder does not render|widget)|begin frame" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
