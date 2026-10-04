#!/usr/bin/env bash
# A link asked for in a second window, middle-clicked inside a browser window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-routed-link.sh /build/chromium/src
#
# Headless with software compositing, like guard-webview-click.sh: nothing here
# is measured in pixels.
#
# A middle click on a link asks for it in a new window. The browser handles it
# in `WebContentsDelegate::OpenURLFromTab` with a NEW_BACKGROUND_TAB
# disposition. content's default does nothing, so without `WebViewGuest`'s
# override the click is silently dropped.
#
# guard-webview-new-window.sh covers the `target="_blank"` path
# (`CreateNewWindow`). Both paths open the same browser window through
# `ReportNewWindow`, so the shell's list cannot tell them apart. This guard
# also reads the engine's own log line from `OpenURLFromTab`.
#
# Assertions, in order; each is meaningful only if the previous one holds:
#
#   the shell page ran               or nothing was set up
#   a press reached the shell's      the harness can deliver a click; without
#     document                        it, an absence below means nothing
#   there is a page in the window    a guest was made, attached and navigated
#   the press landed in the page     the hit test reached the guest
#   the browser was asked            the engine logged OpenURLFromTab on the
#                                     guest with a new-window disposition
#   the window was listed            a browser window at the link's address
#                                     reached the desk's list
#   the guest stayed where it was    a middle click must not navigate the
#                                     current page
#
# A listed window without the engine's line fails: the list alone would pass
# on a fork with no `OpenURLFromTab` override.
#
# NEGATIVE=1 is the control: a left click on the same point of the same link.
# It must navigate the guest in place and ask the browser for nothing. Only the
# button differs, so a geometry error cannot pass as the claim.
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
  annotate "guard-webview-routed-link: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-routed-link-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-routed-link-profile}"
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
# The middle of the guest's page, which is one full-bleed link. The run and the
# control both press here, so a missed press cannot look like an ignored one.
WINDOW_X=$((WIDTH / 2))
LINK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

# Time for the shell to load and its guest to attach and navigate.
FOR_SECONDS="${FOR_SECONDS:-90}"

# The run and the control write separate logs, so both can be compared when
# they disagree.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-routed-link$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-routed-link$WHICH-http.log}"
CLICK_LOG="${CLICK_LOG:-/tmp/domicile-webview-routed-link$WHICH-mouse.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-routed-link: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-routed-link: no python3, and the pages in the window and the click are both driven by one"
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
  annotate_from "guard-webview-routed-link: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-routed-link: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page with one link at $SITE/page"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin only.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-routed-link.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" || {
  annotate_from "guard-webview-routed-link: the shell page never ran, so nothing here was ever set up" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-routed-link: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. Wait for the guest's page before clicking in it.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# Hit testing uses submitted compositor frames. The page running does not mean
# its first frame reached the browser, so wait before clicking.
sleep 3

# 4. A press on the shell's strip. It proves clicks are delivered, so missing
#    readings below are real results.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. The middle button on the guest's link, or the left button in the control.
BUTTON="middle"
[ "$NEGATIVE" = "1" ] && BUTTON="left"
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" --button "$BUTTON" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# `Input.dispatchMouseEvent` returns once the event is forwarded, before it is
# handled. Wait long enough for the delegate, the new window, the list and the
# page load. A fixed wait, not a poll, because the control expects absences.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_PRESS=$(saw "GUARD page-mousedown")
# Logged by WebViewGuest::OpenURLFromTab's new-window arm, so it shows the
# gesture reached this delegate rather than CreateNewWindow. ReportNewWindow's
# line is shared by both paths and cannot tell them apart.
SAW_ROUTED=$(saw "domicile: a <webview> routed a second-window gesture")
# A browser window at the link's address in the desk's list: the delegate's
# result reached the shell.
SAW_ASKED=$(saw "GUARD new-window url=$SITE/opened")
# Whether the guest navigated itself. A middle click must not; the control
# must. Read from the element, since /opened also loads in the new window.
SAW_MOVED=$(saw "GUARD first-page url=$SITE/opened")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE button=$BUTTON"
echo "the shell's document saw: press=$SAW_CHROME asked=$SAW_ASKED"
echo "the browser process said: routed=$SAW_ROUTED"
echo "the page in the window saw: press=$SAW_PRESS moved=$SAW_MOVED"
echo

# The verdict: names the component to blame. Checks run in dependency order.
# `scripts/test-webview-routed-link-guard.sh` runs this block directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CHROME" != "1" ]; then
  FAILURE="no press reached the shell's document at all, so the click was \
never delivered to this browser and every reading below is about a desktop \
nobody touched. This is the harness, not the routing"
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no link under the \
press. That is the guest: it was not made, not attached, or not navigated. The \
engine's log has the browser's own line for an attach, and the http log says \
whether the page was ever asked for"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the press never reached the page in the window: it was hit-tested \
to the chrome around it, or to nothing. That is this harness or the element's \
box rather than anything about routing -- what a link does is only asked once \
a press has landed on one"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_ASKED" = "1" ]; then
    FAILURE="the control asked for a window. An ORDINARY LEFT CLICK on a plain \
link was reported to the shell as a window to open, so what the positive run \
reads is not the button: this guest sends any press to its delegate, which is \
a worse desktop than the hole this guard is about -- every link would open \
twice"
  elif [ "$SAW_ROUTED" = "1" ]; then
    FAILURE="the control's press reached the browser. A left click on a plain \
link is a navigation the guest performs itself and has no business at \
OpenURLFromTab, so a run where it arrives there says the positive reading is \
this element routing everything rather than routing what the page could not do \
itself"
  elif [ "$SAW_MOVED" != "1" ]; then
    FAILURE="the control's press followed no link: the guest never navigated \
to the address the link names. So the absence above is not a measurement -- a \
press that lands on nothing asks for nothing whatever the delegate does. This \
is geometry, and the press point is derived from the window's size; the \
positive run uses the SAME point, so it was measuring nothing either"
  else
    PASSED="the control is sharp: the same point on the same link, pressed \
with the left button, was followed in the guest and the browser was never \
asked for a window. So what the positive run reads is the button and not the \
geometry"
  fi
elif [ "$SAW_ROUTED" != "1" ] && [ "$SAW_ASKED" = "1" ]; then
  FAILURE="THE SHELL WAS ASKED AND THIS DELEGATE NEVER RAN, which is this \
guard measuring the other hole rather than the claim. ReportNewWindow is \
shared, so CreateCustomWebContents -- the target=_blank path #447 closed -- \
opens the identical window, and a run reading only the shell's side would go \
green against a fork with no OpenURLFromTab override at all. Either the middle \
click is reaching CreateNewWindow rather than the delegate at this pin, or the \
engine's line moved and this guard's grep did not follow it"
elif [ "$SAW_ROUTED" != "1" ] && [ "$SAW_MOVED" = "1" ]; then
  FAILURE="THE GUEST FOLLOWED THE LINK IN PLACE, which is what the LEFT button \
does: the press arrived as an ordinary click, so this run measured the \
control's gesture under the claim's name. That is the button rather than the \
delegate -- guard-webview-click-mouse.py sends --button, and the middle one is \
4 in the buttons mask and \"middle\" in the button field, which have to agree \
or Blink reads the press as primary"
elif [ "$SAW_ROUTED" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: a middle click landed on a link and \
nothing reached the guest's delegate, and nothing happened at all -- no \
window, no navigation. So the gesture died between the renderer and the \
browser, or it reached a WebContentsDelegate that does not override \
OpenURLFromTab -- which is content's default, returning null and doing \
nothing, and is exactly the hole this guard exists for"
elif [ "$SAW_MOVED" = "1" ]; then
  FAILURE="the guest did the gesture TWICE: the browser was asked for a second \
window AND the first one went to the address as well. A middle click asks for \
one window and leaves the current page alone, so a desktop built on this would \
show the link opening in two places at once. The disposition is what decides \
it -- a new-window one must not also reach the guest's own NavigationController"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE DELEGATE TOOK IT AND SAID NOTHING: OpenURLFromTab ran on the \
guest and the shell was never told, so the answer died on the way out. That is \
ReportNewWindow, the browser window it opens or the list rather than the routing \
-- a user middle-clicking that link watches nothing happen, which is the same \
symptom as not being asked at all and a different fault. The engine's log has \
the disposition it was asked with"
else
  PASSED="a middle click on an ordinary link reached the guest's delegate, \
which refused to let content open the window and opened a browser window at \
the address instead, which the shell heard in the desk's list \
-- and left the page where it was. Which is what a user middle-clicking a link \
in a browser window gets, measured end to end, with the browser's own line \
saying it was THIS delegate rather than the target=_blank path that answered"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-routed-link: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
