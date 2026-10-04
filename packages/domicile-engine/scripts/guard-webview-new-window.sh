#!/usr/bin/env bash
# Checks a target="_blank" link inside a browser window opens a second window
# the shell draws.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-new-window.sh /build/chromium/src
#
# Runs headless with software compositing, like guard-webview-click.sh, since
# nothing is measured in pixels.
#
# A browser window's page is a guest with no SiteInstance of its own, which
# keeps the user logged in, but content CHECKs for one in
# `WebContentsImpl::CreateNewWindow`. So `WebViewGuest` refuses content's window
# and opens a desk browser window at the address instead
# (src/components/domicile/mojom/browser_windows.mojom). The shell sees it in
# `browserwindowschanged` and draws it.
#
# Asserts, in order, since each reading depends on the one before:
#
#   - the shell page ran
#   - a press reached the shell's document, so the harness can deliver clicks
#   - a page loaded in the window
#   - the press landed in the guest page, not just on the element
#   - a browser window was opened and reached the shell
#   - at the address the link named
#   - the shell created a second view for it
#   - that view's page loaded, so the user sees the linked page
#
# The last two are required because a listed window is not a window on screen.
# Unit tests cannot cover this: happy-dom has no guest or browser process to
# refuse a window.
#
# NEGATIVE=1 runs the negative control: it clicks an ordinary link in the same
# guest. It must open no window and must navigate in place, so a window opened
# for any click, navigation or attach cannot pass the positive run. A click on
# the shell's strip would be too weak a control, since it reaches no guest.
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
  annotate "guard-webview-new-window: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 clicks the ordinary link instead of the `_blank` one.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-new-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-new-window-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# The shell's strip height in CSS pixels. The press points derive from it so
# the strip and links stay aligned.
#
# Not named `STRIP`: `nix develop .#full` exports STRIP=strip, which breaks the
# arithmetic below under `set -u`. `scripts/test-webview-guard-startup.sh`
# starts every guard in that environment to catch this.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's top half (the `target="_blank"` link) and bottom
# half (the ordinary link), well clear of the seam between them.
WINDOW_X=$((WIDTH / 2))
BLANK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 4))
SAME_Y=$((STRIP_HEIGHT + 3 * (HEIGHT - STRIP_HEIGHT) / 4))

# Time for the shell to load and get a guest attached and navigated. Generous
# because every step is asynchronous and the machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# Separate logs for the run and its negative control, so the diagnostics show
# both.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-new-window$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-new-window$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-new-window$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-new-window: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-new-window: no python3, and the pages in the window and the click are both driven by one"
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

# 1. The page in the window and the two its links lead to. Served locally
#    because `crux` cannot reach arbitrary hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-new-window-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-new-window: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-new-window: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page with a target=_blank link at $SITE/opener"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost only for that origin. `--app` matches `domicile`'s
#    configuration.
#
#    Clicks arrive over `--remote-debugging-port`, since there is no pointer.
#    guard_webview_devtools.py explains why they are hit-tested like real ones.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/opener" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-new-window.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-new-window: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  # An engine that died says why above its stack, and the tail above keeps
  # only the bottom of a long one.
  if grep -qE 'FATAL|Check failed|Received signal' "$ENGINE_LOG"; then
    echo "where it died:" >&2
    grep -m1 -A60 -E 'FATAL|Check failed|Received signal' "$ENGINE_LOG" >&2
  fi
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-new-window: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. Wait for a page in the window before clicking it.
wait_for_line "$TRIES" "GUARD opener-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# Hit testing uses the widgets' submitted compositor frames. The page running
# does not mean its first frame reached the browser, so wait.
sleep 3

# 4. A press on the shell's strip, which this document must report. Without
#    it, "no click arrived" reads the same as "the link opened nothing".
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. The click under test: the `target="_blank"` link in the top half, or the
#    ordinary link in the bottom half for the negative control.
LINK_Y="$BLANK_Y"
[ "$NEGATIVE" = "1" ] && LINK_Y="$SAME_Y"
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# `Input.dispatchMouseEvent` returns once the event is forwarded, before it is
# handled. Allow time for the second window to open, attach and load.
#
# A fixed wait, not a poll, because the negative control checks for absences.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD opener-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
SAW_ASKED=$(saw "GUARD new-window url=")
# Matches the address too: a window at the wrong address would otherwise pass.
SAW_ADDRESS=$(saw "GUARD new-window url=$SITE/opened")
SAW_SECOND=$(saw "GUARD second-view")
# Reads the element, not the page: the window's page loads whether or not
# anything draws it, so `opened-loaded` alone would pass an empty second view.
SAW_OPENED=$(saw "GUARD second-page url=$SITE/opened")
# The ordinary link was followed in place. Expected in the negative control;
# in the claim's run it means the press hit the wrong link.
SAW_STAYED=$(saw "GUARD stayed-loaded")
# Logged by WebViewGuest::CreateCustomWebContents. Separates "the renderer
# never asked for a window" from "the browser refused it and nothing reached
# the page", which look the same from the shell's document.
SAW_REFUSED=$(saw "domicile: a <webview> refused to open a window for")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the shell's document saw: press=$SAW_CHROME asked=$SAW_ASKED address=$SAW_ADDRESS second=$SAW_SECOND"
echo "the browser process said: refused=$SAW_REFUSED"
echo "the pages in the windows saw: press=$SAW_GUEST opened=$SAW_OPENED stayed=$SAW_STAYED"
echo

# Picks which side to blame. `scripts/test-webview-new-window-guard.sh` runs
# this block directly.
#
# Ordered by dependency: each arm assumes the readings before it held.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so the click was \
never delivered to this browser and every reading below is about a desktop \
nobody touched. This is the harness, not the link"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so the press below landed in an \
empty frame and there was no link under it. That is the guest: it was not \
made, not attached, or not navigated. The engine's log has the browser's own \
line for an attach, and the http log says whether the page was ever asked for"
elif [ "$SAW_GUEST" != "1" ]; then
  FAILURE="the press never reached the page in the window: it was hit-tested \
to something else, or to nothing. That is this harness or the element's box \
rather than anything about windows — what a link does is only asked once a \
press has landed on one"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ASKED" = "1" ]; then
    FAILURE="the control asked for a window. An ordinary link — no target — \
was clicked and a browser window opened anyway, so what the positive run \
reads is not the link's target: it is a window opened for any click, any \
navigation, or the attach itself"
  elif [ "$SAW_STAYED" != "1" ]; then
    FAILURE="the control's press followed no link: the page in the window \
never navigated to the address the ordinary link names. So the absence above \
is not a measurement — a press that lands on nothing asks for nothing whatever \
the element does. This is geometry: the halves of the fixture and the two \
press points are both derived from the window's size"
  else
    PASSED="the control is sharp: an ordinary link in the same guest, clicked \
the same way, navigated the window it was in and asked for no second one. So \
what the positive run reads is the link's target and not the configuration"
  fi
elif [ "$SAW_ASKED" != "1" ] && [ "$SAW_STAYED" = "1" ]; then
  FAILURE="the press landed on the WRONG LINK: the window followed the \
ordinary link, which is the control's target and sits in the other half of the \
page. Nothing here is about a link asking for a window — this is geometry, \
press points and the fixture's halves are both derived from the window's size"
elif [ "$SAW_ASKED" != "1" ] && [ "$SAW_REFUSED" = "1" ]; then
  FAILURE="THE BROWSER WAS ASKED AND THE PAGE WAS NOT TOLD: \
WebViewGuest::CreateCustomWebContents ran — it refused the window, which it \
must — and no window reached this document's list. So the crossing works and \
the report does not: the browser window the host opened \
(domicile_browser_windows.cc, which logs 'opened browser window'), the list \
BrowserWindowsClient carries, or DomicileHost's browserwindowschanged"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: a press landed on the link and \
WebContentsImpl::CreateNewWindow never reached this guest's delegate. So the \
renderer did not ask for a window at all — the link's target did not survive \
the page, the navigation was swallowed before it became a window request, or \
the press did not land on the anchor it looks like it did. The engine log is \
where this starts, and the http log says which pages were asked for"
elif [ "$SAW_ADDRESS" != "1" ]; then
  FAILURE="THE WINDOW WAS OPENED AT THE WRONG ADDRESS: a window arrived and \
it is not at the address the link names. A window opened at the wrong page is \
worse than none — see the reported url above. The address is the window's \
visible entry, which a browser-initiated navigation shows from the start, and \
it crosses as a url.mojom.Url, so an empty or relative one arriving here is \
that crossing"
elif [ "$SAW_SECOND" != "1" ]; then
  FAILURE="the shell was told and drew nothing: this guard's own page heard \
the list and made no second <webview>. That is this script's page rather than \
the engine — see guard-webview-new-window.js, which appends the element in the \
handler"
elif [ "$SAW_OPENED" != "1" ]; then
  FAILURE="A WINDOW IN THE LIST AND NONE ON THE SCREEN, WHICH IS THE FAILURE \
THIS GUARD EXISTS TO SEPARATE FROM A PASS: the window opened at the right \
address, the shell made a second <webview> naming it, and the page never \
arrived in it. So the window's page was never navigated, or never attached to \
the element — a user clicking that link sees an empty window. The engine's \
'attached browser window' line and the http log's record of whether /opened \
was ever requested are the two ends of it"
else
  PASSED="a link with target=\"_blank\", clicked inside a browser window, \
opened a browser window at the address it names, the shell heard it in the \
desk's list — and the second <webview> the shell drew it in showed that page. \
Which is the whole of what a user asking for a new window gets, measured end \
to end"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-new-window: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
