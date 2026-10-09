#!/usr/bin/env bash
# The link under the pointer in a browser window reaches the shell as
# `targetUrl`, for a status bubble like Chrome's.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-target-url.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-click.sh: nothing here
# is measured in pixels.
#
# The guest's renderer reports a hovered link to its WebContentsDelegate's
# `UpdateTargetURL`, which content's default ignores. `WebViewGuest` sends it to
# the element as `TargetUrlChanged`, and the element fires
# `domicile-target-url-change`. The renderer reports nothing when the pointer
# leaves the page, so the element calls `PointerLeft` when the shell's document
# sees a move, and `WebViewGuest::PreHandleMouseEvent` reports the link again
# when the pointer comes back. A unit test cannot check this: happy-dom has no
# nested browsing context.
#
# The page is guard-webview-routed-link-server.py's: one full-bleed link.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   a move reached the shell's       the harness can deliver a move; without
#     document                        it, an absence below means nothing
#   there is a page in the window    a guest was made, attached and navigated
#   the link was reported            the pointer over the link set `targetUrl`
#                                     to the link's address
#   the link was cleared             the pointer leaving set it back to empty,
#                                     so the shell's bubble goes away
#   the link came back               the pointer back on the same link set it
#                                     again, though the renderer saw no change
#
# NEGATIVE=1 is the control: the pointer moves only on the strip. Nothing may
# be reported, or the positive run's report could come from the load rather
# than the hover.
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
  annotate "guard-webview-target-url: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-target-url-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-target-url-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Height of the shell's strip in CSS pixels. The press points derive from it.
#
# Not `STRIP`: `nix develop .#full` exports `STRIP=strip`, which breaks the
# arithmetic below under `set -u`. `scripts/test-webview-guard-startup.sh`
# starts every guard in that environment to catch this.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's page, which is one full-bleed link.
WINDOW_X=$((WIDTH / 2))
LINK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

# Time for the shell to load and its guest to attach and navigate, and for
# each report the positive run waits on.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-target-url$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-target-url$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-target-url$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-target-url: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-target-url: no python3, and the page in the window and the pointer are both driven by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

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
python3 "$SCRIPTS/guard-webview-routed-link-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-target-url: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-target-url: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page that is one link to $SITE/opened"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-target-url.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-target-url: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-target-url: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. Wait for the guest's page before moving over it.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# Hit testing uses submitted compositor frames. The page running does not mean
# its first frame reached the browser, so wait before moving.
sleep 3

# 4. A move on the shell's strip. It proves moves are delivered, so missing
#    readings below are real results.
python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first move could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousemove" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first move" >&2

# The element brackets the address, so an empty one reads `url=[]`.
LINK_LINE="GUARD target-url url=[$SITE/opened]"
CLEARED_LINE="GUARD target-url url=[]"

# 5. Over the link and back to the strip, or a second point on the strip in the
#    control.
if [ "$NEGATIVE" = "1" ]; then
  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$((CHROME_X / 2))" --y "$CHROME_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the second move could not be driven; see $CLICK_LOG" >&2
  # A fixed wait, not a poll, because the control expects an absence.
  sleep 5
else
  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the move over the link could not be driven; see $CLICK_LOG" >&2
  wait_for_line "$TRIES" "$LINK_LINE" "$ENGINE_LOG" ||
    echo "the shell never heard of the link under the pointer" >&2

  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the move off the link could not be driven; see $CLICK_LOG" >&2
  wait_for_line "$TRIES" "$CLEARED_LINE" "$ENGINE_LOG" ||
    echo "the shell never heard the pointer leave the link" >&2

  python3 "$SCRIPTS/guard-webview-click-mouse.py" --move \
    --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" \
    >>"$CLICK_LOG" 2>&1 ||
    echo "the move back over the link could not be driven; see $CLICK_LOG" >&2
  for _ in $(seq 1 "$TRIES"); do
    [ "$(grep -cF "$LINK_LINE" "$ENGINE_LOG")" -ge 2 ] && break
    sleep 0.25
  done
fi

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousemove")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_LINK=$(saw "$LINK_LINE")
SAW_CLEARED=$(saw "$CLEARED_LINE")
# The link reported a second time, after the pointer came back onto it.
SAW_BACK=$([ "$(grep -cF "$LINK_LINE" "$ENGINE_LOG")" -ge 2 ] && echo 1 || echo 0)
SAW_ANY=$(saw "GUARD target-url")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the shell's document saw: move=$SAW_CHROME link=$SAW_LINK cleared=$SAW_CLEARED back=$SAW_BACK any=$SAW_ANY"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `scripts/test-webview-target-url-guard.sh` runs this block directly.
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
  FAILURE="nothing loaded in the window, so there was no link to hover. That \
is the guest: it was not made, attached or navigated"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ANY" = "1" ]; then
    FAILURE="the control heard a link the pointer never crossed, so the \
positive run's report may come from the load rather than the hover"
  else
    PASSED="the control is sharp: with the pointer only on the strip, the \
element reported no link"
  fi
elif [ "$SAW_LINK" != "1" ]; then
  FAILURE="the pointer was over the link and the shell never heard of it. \
Either the guest's UpdateTargetURL is not overridden (content's default does \
nothing), or TargetUrlChanged never reached the element"
elif [ "$SAW_CLEARED" != "1" ]; then
  FAILURE="the link was reported and never cleared when the pointer left, so \
a shell's bubble stays up over the page. The element calls PointerLeft when \
the shell's document sees a move off it"
elif [ "$SAW_BACK" != "1" ]; then
  FAILURE="the pointer came back onto the link and the shell never heard of it \
again, so a shell's bubble stays hidden. The renderer reports only changes, so \
WebViewGuest::PreHandleMouseEvent must report the renderer's last link on the \
next mouse event"
else
  PASSED="the link under the pointer reached the shell as targetUrl, cleared \
when the pointer left it, and came back with the pointer"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-target-url: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the moves did:" >&2
tail -20 "$CLICK_LOG" >&2
exit 1
