#!/usr/bin/env bash
# A <webview> whose page's renderer crashes tells the shell why, draws nothing
# while it is gone, and comes back on reload().
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-crash.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the shell's and the page's console lines from the browser's log, and three
# pixels of the window over the debugging port.
#
# Why: the shell draws its own recovery card for a page that died. It needs the
# reason (`renderProcessGone`, from WebViewGuest::ReportRenderProcess) and a
# view that does not paint Chromium's gray sad frame over the card (patch 0124,
# RemoteFrame::ChildProcessGone).
#
# The shell shows a green page in a full-size <webview> over a magenta body,
# navigates the view to `chrome://crash`, then calls reload() once it hears
# the page gone. A dying renderer prints its stack first, which can take
# seconds, and a reload sent to it before then is lost with it. Asserted:
#
#   the shell page ran          or nothing was set up
#   the page loaded             the view reported it loaded
#   the shell heard why         `renderProcessGone` is `crashed`, with a
#                               nonzero `renderProcessExitCode`
#   it came back                `renderProcessGone` is "" again after reload(),
#                               and the page loaded a second time
#   live, dead, live            the view's center is green while the page
#                               runs, the shell's magenta while it is gone,
#                               and green after the reload
#
# Control: NEGATIVE=1 leaves the page alone. The shell must hear nothing, and
# the view's center must stay green, so the claim's magenta is the crash's
# doing.
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

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-crash: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 leaves the page alone. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="crash"
CRASH=1
[ "$NEGATIVE" = "1" ] && MODE="still" && CRASH=0

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-crash$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-crash$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-crash$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-crash$WHICH-http.log}"
PIXEL_LOG="${PIXEL_LOG:-/tmp/domicile-webview-crash$WHICH-pixel.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
WIDTH="${WIDTH:-800}"
HEIGHT="${HEIGHT:-600}"
# How long the shell waits between loaded and the crash, and between hearing
# the page gone and the reload, so the guard reads a pixel at each stage.
SETTLE_MS="${SETTLE_MS:-4000}"
# How long a new frame takes to reach the window before a pixel is read.
SETTLE_SECONDS="${SETTLE_SECONDS:-1}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-crash: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-crash: no python3, which serves the page and reads the pixels"
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
python3 "$SCRIPTS/guard-webview-crash-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-crash: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-crash: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The engine. `src` goes last: it is a URL. Pixels are read over
#    `--remote-debugging-port`; see guard-webview-crash-pixel.py.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?crash=$CRASH&settle=$SETTLE_MS&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-crash.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran; the verdict below says what that means" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-crash: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

# The color at the view's center, or `none` when it could not be read.
rm -f "$PIXEL_LOG"
pixel() {
  local read
  read="$(python3 "$SCRIPTS/guard-webview-crash-pixel.py" --port "$DEBUG_PORT" \
    --x $((WIDTH / 2)) --y $((HEIGHT / 2)) 2>>"$PIXEL_LOG")"
  echo "$read" >>"$PIXEL_LOG"
  case "$read" in
  "GUARD pixel="*) echo "${read#GUARD pixel=}" ;;
  *) echo none ;;
  esac
}

# 3. A pixel at each stage: once loaded, once the page is gone (or, in the
#    control, once the shell has left it), and once reloaded.
wait_for_line "$TRIES" "GUARD loaded" "$ENGINE_LOG" ||
  echo "the page never loaded; the verdict below says what that means" >&2
sleep "$SETTLE_SECONDS"
LIVE="$(pixel)"

if [ "$CRASH" = "1" ]; then
  wait_for_line "$TRIES" "GUARD render-process gone=" "$ENGINE_LOG" ||
    echo "the shell never heard the page go; the verdict below says what that means" >&2
else
  wait_for_line "$TRIES" "GUARD leaving-it" "$ENGINE_LOG" ||
    echo "the shell never reached its step; the verdict below says what that means" >&2
fi
sleep "$SETTLE_SECONDS"
DEAD="$(pixel)"

wait_for_line "$TRIES" "GUARD reloading" "$ENGINE_LOG" ||
  echo "the shell never reloaded the view" >&2
for _ in $(seq 1 "$TRIES"); do
  [ "$(grep -c "GUARD page-loaded" "$ENGINE_LOG" 2>/dev/null)" -ge 2 ] && break
  sleep 0.25
done
sleep "$SETTLE_SECONDS"
AFTER="$(pixel)"

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# What the shell heard: the first reason other than `none`, whether its exit
# code was nonzero, and whether `none` came after it.
HEARD="$(awk '
  match($0, /GUARD render-process gone=[a-z-]+ exit=-?[0-9]+/) {
    split(substr($0, RSTART + 26, RLENGTH - 26), part, " exit=")
    if (part[1] != "none" && gone == "") { gone = part[1]; code = part[2] }
    else if (part[1] == "none" && gone != "") { back = 1 }
  }
  END {
    printf "%s %d %d\n", (gone == "" ? "none" : gone), (code != "" && code != 0),
      back
  }' "$ENGINE_LOG" 2>/dev/null)"

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_LOADED=$(saw "GUARD loaded")
RELOADED=0
[ "$(grep -c "GUARD page-loaded" "$ENGINE_LOG" 2>/dev/null)" -ge 2 ] && RELOADED=1

MEASURED="$MODE $SAW_SHELL $SAW_LOADED $HEARD $RELOADED $LIVE $DEAD $AFTER"
echo
echo "measured: $MEASURED"
echo "  (mode shell loaded gone exit-nonzero back reloaded live dead after)"

FAILURE=""
PASSED=""
case "$MEASURED" in
"crash 1 1 crashed 1 1 1 00ff00 ff00ff 00ff00")
  PASSED="a <webview> whose renderer crashed said why, drew nothing over the \
shell while it was gone, and came back on reload()"
  ;;
"still 1 1 none 0 0 1 00ff00 00ff00 00ff00")
  PASSED="the control is sharp: a page left alone said nothing and stayed \
drawn, so the claim's report and magenta are the crash's doing"
  ;;
"crash 0 "* | "still 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"crash 1 0 "* | "still 1 0 "*)
  FAILURE="the page never loaded in the <webview>: no guest was attached, or \
its server never answered"
  ;;
"crash 1 1 none "*)
  FAILURE="THE PAGE'S RENDERER WENT AWAY AND THE SHELL HEARD NOTHING: no \
domicile-render-process-change (WebViewGuest::ReportRenderProcess, \
NavigationStateChanged, HTMLWebViewElement::RenderProcessChanged), or \
chrome://crash crashed nothing (ShouldBlockRendererDebugURL)"
  ;;
"crash 1 1 crashed 0 "*)
  FAILURE="the shell heard the crash with an exit code of 0, so \
renderProcessExitCode is not WebContents::GetCrashedErrorCode"
  ;;
"crash 1 1 crashed 1 0 "*)
  FAILURE="renderProcessGone never went back to \"\" after reload(): a new \
renderer came up unreported, or the reload never started one"
  ;;
"crash 1 1 crashed 1 1 0 "*)
  FAILURE="the shell heard the page come back, but the page never loaded \
again"
  ;;
"crash 1 1 crashed 1 1 1 00ff00 ff00ff "*)
  FAILURE="the page came back and loaded, but its view did not draw it \
again: its center was $AFTER after the reload (RemoteFrame::SetFrameSinkId)"
  ;;
"crash 1 1 crashed 1 1 1 00ff00 "*)
  FAILURE="THE DEAD <webview> STILL DRAWS: its center was $DEAD, not the \
shell's ff00ff (808080 is Chromium's sad frame), so the shell's own card \
would be covered (RemoteFrame::ChildProcessGone, patch 0124)"
  ;;
"crash 1 1 "* | "still 1 1 "*)
  FAILURE="the pixels are not the page's and the shell's (live $LIVE, dead \
$DEAD, after $AFTER) -- none means a screenshot failed; see $PIXEL_LOG"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-crash: $FAILURE" "$ENGINE_LOG"
echo "the shell's and the page's lines, in order:" >&2
grep -E "GUARD " "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
