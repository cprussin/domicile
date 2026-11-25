#!/usr/bin/env bash
# A browser window that slides keeps its page's place until the slide ends:
# the page does not get a screen-rect update each frame.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-slide-screen-rects.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It counts
# the page's WidgetBase::UpdateScreenRects in a trace, so it needs no pixels
# and no client.
#
# Why: manganese slides a workspace's windows with a transform animation while
# its shell runs a main frame every frame. Each of those main frames sent every
# sliding page its new place, and each page ran a main frame for it. A
# <webview>'s page keeps its place, as it keeps its size and raster scale,
# while a transform animation runs on its element or a box around it, and
# takes the new one when the animation ends (patch 0281).
#
# The shell (guard-webview-slide-screen-rects.js) slides the window's box
# 200px over a second with a CSS animation while it changes its own style
# every frame, then leaves it there. Asserted:
#
#   the shell page ran    or nothing was set up
#   the page was shown    a window was opened and its <webview> reported it
#   the slide ended       the shell logged its end
#   the trace saw it      the slide ended before the trace did
#   few updates           the page got at most MAX_UPDATES screen-rect updates
#                         from the slide's start to a second after its end
#   its new place         and at least one: it learned where it ended up
#
# Control: NEGATIVE=1 slides the box on `left` instead, which no transform
# animation holds, so the page gets its place every frame and the count sees
# many.
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
  annotate "guard-webview-slide-screen-rects: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 slides on `left`. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
WHICH=""
if [ "$NEGATIVE" = "1" ]; then
  MODE="control"
  WHICH="-negative"
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-slide-screen-rects$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-slide-screen-rects$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-slide-screen-rects$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-slide-screen-rects$WHICH-http.log}"
TRACE="${TRACE:-/tmp/domicile-webview-slide-screen-rects$WHICH-trace.json}"
# How long the engine traces. Covers the page's load, the 2s wait, the slide
# and the second after it, with room for a loaded runner.
TRACE_SECONDS="${TRACE_SECONDS:-20}"
# The slide's end sends one. A page sent its place each frame of a one second
# slide gets dozens.
MAX_UPDATES="${MAX_UPDATES:-3}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-slide-screen-rects: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-slide-screen-rects: no python3, which serves the page and reads the trace"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

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
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-slide-screen-rects: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-slide-screen-rects: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The engine, tracing the renderers for screen-rect updates and
#    devtools.timeline for the shell's TimeStamps. `src` goes last: it is a
#    URL.
rm -f "$ENGINE_LOG" "$TRACE"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=1024,768 \
  --app="domicile://shell/?mode=$MODE&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-slide-screen-rects.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --trace-startup=renderer,devtools.timeline \
  --trace-startup-duration="$TRACE_SECONDS" \
  --trace-startup-file="$TRACE" \
  --trace-startup-format=json \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 3. Wait for the slide, then for the trace, written when it ends.
wait_for_line $((TRACE_SECONDS * 4)) "GUARD done" "$ENGINE_LOG" ||
  echo "the shell never finished; the verdict below says what that means" >&2

# The screen-rect updates outside the shell's process between the shell's
# `GUARD sliding` and `GUARD done` TimeStamps, or `none` when the trace was
# never written, does not parse or holds neither TimeStamp.
updates() {
  python3 -I - "$TRACE" <<'EOF' 2>/dev/null || echo none
import json
import sys

with open(sys.argv[1], encoding="utf-8") as trace:
    events = json.load(trace)["traceEvents"]


def mark(name):
    return next(
        event
        for event in events
        if event.get("name") == "TimeStamp"
        and name in json.dumps(event.get("args", {}))
    )


try:
    start, end = mark("GUARD sliding"), mark("GUARD done")
except StopIteration:
    sys.exit(1)
shell = start["pid"]
print(
    sum(
        1
        for event in events
        if event.get("name") == "WidgetBase::UpdateScreenRects"
        and event.get("ph") in ("X", "B")
        and event.get("pid") != shell
        and start["ts"] < event.get("ts", 0) < end["ts"]
    )
)
EOF
}
UPDATES="none"
for _ in $(seq 1 $((TRACE_SECONDS * 4))); do
  UPDATES="$(updates)"
  [ "$UPDATES" != "none" ] && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# 1 when the slide ended before the trace did, so the trace holds all of it.
# The browser process logs both lines, in order.
covered() {
  local ended traced
  ended="$(grep -nF "GUARD done" "$ENGINE_LOG" | head -1 | cut -d: -f1)"
  traced="$(grep -nF "Completed startup tracing" "$ENGINE_LOG" | head -1 | cut -d: -f1)"
  if [ -n "$ended" ] && [ -n "$traced" ] && [ "$ended" -lt "$traced" ]; then
    echo 1
  else
    echo 0
  fi
}

MEASURED="$MODE $(saw "GUARD shell-loaded") $(saw "GUARD page-shown") $(saw "GUARD done") $(covered) $UPDATES"
echo
echo "measured: $MEASURED (max $MAX_UPDATES)"
echo "  (mode shell page-shown done traced screen-rect-updates)"

# Which end to blame. `packages/domicile-engine/tests/test-webview-slide-screen-rects-guard.sh`
# runs this block directly. MEASURED is "<mode> <shell> <page> <done>
# <traced> <updates>"; MAX_UPDATES is the bar.
FAILURE=""
PASSED=""
read -r M_MODE M_SHELL M_PAGE M_DONE M_TRACED M_UPDATES <<<"$MEASURED"
if [ "$M_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
elif [ "$M_PAGE" != "1" ]; then
  FAILURE="the page was never shown: openBrowserWindow opened no window, the \
list never reached the shell, or the <webview> never reported its page"
elif [ "$M_DONE" != "1" ]; then
  FAILURE="the slide never ended, so it was never measured: the shell threw \
or its animation never finished"
elif [ "$M_TRACED" != "1" ]; then
  FAILURE="the trace ended before the slide did, so it does not hold the \
slide to count: raise TRACE_SECONDS for a slow runner"
elif [ "$M_UPDATES" = "none" ]; then
  FAILURE="the trace was never written, does not parse or holds no 'GUARD \
sliding' and 'GUARD done' TimeStamps, so there is nothing to count: the engine \
died before --trace-startup-duration ended, or console.timeStamp no longer \
reaches devtools.timeline"
elif [ "$M_UPDATES" = "0" ]; then
  FAILURE="the page got no screen-rect update for the slide, not even at its \
end, so it never learned its new place, or the trace no longer holds \
WidgetBase::UpdateScreenRects. The animation's end sends a held rect \
(RemoteFrameView::ReleaseHeldRect, patch 0281)"
elif [ "$M_MODE" = "claim" ] && [ "$M_UPDATES" -gt "$MAX_UPDATES" ]; then
  FAILURE="a page got $M_UPDATES screen-rect updates while its window slid, \
over $MAX_UPDATES: it was sent its place each frame and ran a main frame for \
each. A <webview>'s page keeps its place while a transform animation runs on \
it or a box around it (RemoteFrame::FrameRectsChanged, patch 0281)"
elif [ "$M_MODE" = "claim" ]; then
  PASSED="a page kept its place while its window slid and learned the new \
one at the end ($M_UPDATES screen-rect updates)"
elif [ "$M_UPDATES" -gt "$MAX_UPDATES" ]; then
  PASSED="the control is sharp: a window slid on 'left' sent its page \
$M_UPDATES screen-rect updates, so the claim's few are the build's doing"
else
  FAILURE="the control slid the window on 'left' and its page got only \
$M_UPDATES screen-rect updates, so a low count in the claim says nothing: the \
count misses updates, or the shell ran no main frames"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-slide-screen-rects: $FAILURE" "$ENGINE_LOG"
echo "the shell's steps, in order:" >&2
grep -F "GUARD" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
