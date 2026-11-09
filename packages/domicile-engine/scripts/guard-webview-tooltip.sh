#!/usr/bin/env bash
# A `title` in a frame from another site reaches the shell as the <webview>'s
# tooltip, at the pointer in the element's coordinates, after Chrome's delay.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-tooltip.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-target-url.sh.
#
# A frame from another site has a render widget of its own, whose mouse events
# are in its own coordinates. Patch 0181 names that widget with the tooltip,
# and WebViewGuest maps the pointer into the page's. Extensions' inline menus
# (Bitwarden's) and challenge frames (Cloudflare's) are such frames. The page's
# iframe sits at 200,150, so a pointer reported in the frame's coordinates
# lands that far up and left of the right place.
#
# The renderer reports a title as soon as the pointer is over it; Chrome's
# browser shows it after a delay, and so must WebViewGuest.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   a move reached the shell's       the harness can deliver a move; without
#     document                        it, an absence below means nothing
#   the page and its frame loaded    a guest was made, attached and navigated
#   the tooltip was reported         the pointer over the titled frame
#   at the pointer                   in the element's coordinates, not the
#                                     frame's
#   after a delay                    not the moment the pointer arrived
#
# NEGATIVE=1 is the control: the pointer rests on the page outside the frame,
# where nothing has a title. Nothing may be reported, or the positive run's
# tooltip could come from somewhere other than the hover.
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
  annotate "guard-webview-tooltip: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-tooltip-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-tooltip-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Not `STRIP`: see guard-webview-target-url.sh.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's page, inside the frame (200,150 to 600,450 in the
# page's coordinates) and 312,202 from its corner.
PAGE_X=$((WIDTH / 2))
PAGE_Y=$(((HEIGHT - STRIP_HEIGHT) / 2))
# The control's point: on the page, clear of the frame.
OUTSIDE_X=100
OUTSIDE_Y=50

# Chrome shows a tooltip 500 ms after the pointer stops. The reading starts
# once the move's script returns, after the move, so it only undercounts.
AT_LEAST_MS=300

FOR_SECONDS="${FOR_SECONDS:-90}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-tooltip$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-tooltip$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-tooltip$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-tooltip: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-tooltip: no python3, and the page in the window and the pointer are both driven by one"
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
python3 "$SCRIPTS/guard-webview-tooltip-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-tooltip: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-tooltip: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page with a titled frame from localhost at $SITE/page"

# 2. The engine, on a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-tooltip.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-tooltip: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-tooltip: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# 3. The page and its frame, and their first frames at the browser: a move is
#    routed by hit test.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
sleep 3

# 4. A move on the shell's strip, so missing readings below are real results.
python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first move could not be driven; see $CLICK_LOG" >&2
wait_for_line 20 "GUARD chrome-mousemove" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first move" >&2

# 5. The pointer onto the frame, or beside it in the control.
TOOLTIP_LINE="GUARD tooltip text=[in a frame]"
if [ "$NEGATIVE" = "1" ]; then
  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$OUTSIDE_X" --y "$((STRIP_HEIGHT + OUTSIDE_Y))" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the move beside the frame could not be driven; see $CLICK_LOG" >&2
  # A fixed wait, not a poll, because the control expects an absence.
  sleep 5
else
  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$PAGE_X" --y "$((STRIP_HEIGHT + PAGE_Y))" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the move onto the frame could not be driven; see $CLICK_LOG" >&2
  MOVED_AT="$(date +%s%3N)"
  wait_for_line "$TRIES" "$TOOLTIP_LINE" "$ENGINE_LOG" ||
    echo "the shell never heard of the frame's title" >&2
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousemove")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_TOOLTIP=$(saw "$TOOLTIP_LINE")
SAW_PLACED=$(saw "$TOOLTIP_LINE x=$PAGE_X y=$PAGE_Y ")
SAW_DELAYED=0
DELAY_MS=""
if [ "$SAW_TOOLTIP" = "1" ] && [ "$NEGATIVE" != "1" ]; then
  SHOWN_AT="$(grep -F "$TOOLTIP_LINE" "$ENGINE_LOG" | head -1 | sed -n 's/.* at=\([0-9]*\).*/\1/p')"
  DELAY_MS=$((SHOWN_AT - MOVED_AT))
  [ "$DELAY_MS" -ge "$AT_LEAST_MS" ] && SAW_DELAYED=1
fi

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the shell's document saw: move=$SAW_CHROME tooltip=$SAW_TOOLTIP placed=$SAW_PLACED delayed=$SAW_DELAYED (${DELAY_MS:-no} ms)"
grep -F "GUARD tooltip" "$ENGINE_LOG" | sed 's/^/  /'
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `packages/domicile-engine/tests/test-webview-tooltip-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up. This is the \
harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no move reached the shell's document, so the pointer was never \
delivered to this browser. This is the harness"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="the page or its frame never loaded, so there was no title to \
hover. That is the guest: it was not made, attached or navigated"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_TOOLTIP" = "1" ]; then
    FAILURE="the control heard the frame's title with the pointer beside the \
frame, so the positive run's tooltip may not come from the hover"
  else
    PASSED="the control is sharp: with the pointer beside the frame, the \
element reported no tooltip"
  fi
elif [ "$SAW_TOOLTIP" != "1" ]; then
  FAILURE="the pointer was over the frame's title and the shell never heard \
of it. Either DomicileTooltip (patch 0181) never reached WebViewGuest from the \
frame's widget, or TooltipChanged never reached the element"
elif [ "$SAW_PLACED" != "1" ]; then
  FAILURE="the tooltip was reported away from the pointer. At 312,202 it is \
in the frame's own coordinates: WebViewGuest must map the pointer from the \
widget that named the tooltip into the page's"
elif [ "$SAW_DELAYED" != "1" ]; then
  FAILURE="the tooltip was reported as soon as the pointer arrived. The \
renderer reports a title at once; WebViewGuest must wait, as Chrome's \
browser does"
else
  PASSED="the frame's title reached the shell at the pointer, in the \
element's coordinates, after a delay"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-tooltip: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the moves did:" >&2
tail -20 "$CLICK_LOG" >&2
exit 1
