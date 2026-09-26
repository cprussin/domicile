#!/usr/bin/env bash
# A link asked for in a second window, middle-clicked inside a browser window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-routed-link.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-click.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. Not every navigation a page asks for is one its own renderer
# can perform. A MIDDLE CLICK on a link asks for it in a second window, and a
# page cannot open one -- the gesture belongs to the browser, which arrives at
# `WebContentsDelegate::OpenURLFromTab` with a NEW_BACKGROUND_TAB disposition.
# content's default implementation returns null and does nothing at all, so for
# as long as `WebViewGuest` did not override it, a middle click in a browser
# window was a click that did NOTHING: no window, no error, nothing in any page
# to notice.
#
# WHAT THIS GUARD USED TO MEASURE, AND WHY IT DOES NOT. It clicked a
# `target="_top"` link inside a frame from another site, on the reasoning that
# a cross-process frame cannot navigate the page around it and must hand the
# navigation to the browser. Engine run 35487254436 settled that and the answer
# was no: the frame WAS remote -- the two renderers are in the log, under
# different pids -- the top page arrived, and the engine's line never appeared.
# So at this pin such a navigation is performed inside
# `Navigator::NavigateFromFrameProxy` without asking any delegate, and it
# already worked before this override existed. The premise was reasoned rather
# than read, the run read it, and the subject moved to the gesture that does
# reach the delegate. That run is why the fixture below is one site and one
# link rather than two hosts and a frame.
#
# NOT THE SAME HOLE AS guard-webview-new-window.sh, and telling them apart is
# THE point rather than a nicety: that one is `CreateNewWindow`, which a
# `target="_blank"` takes and which #447 closed. Both halves end at the same
# `NewWindowRequested`, so THE SHELL CANNOT TELL WHICH PATH ASKED IT. Only the
# engine's own line can, which is why this guard reads that line and not just
# the event.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   the shell page ran               or nothing here was ever set up
#   a press reached the shell's      the harness can deliver a click to this
#     document                        document at all. Without it, an absence
#                                     below is not a measurement
#   there is a page in the window    that a guest was made, attached, navigated
#   the press landed in the page     measured in the guest's own document: the
#                                     hit test crossed into the guest
#   the browser was asked            THE CLAIM's first half, read off the
#                                     engine's own log: OpenURLFromTab ran on
#                                     the guest with a new-window disposition
#   the shell was told               THE CLAIM's other half: the element
#                                     dispatched the event, carrying the address
#   the guest stayed where it was    a middle click asks for a SECOND window and
#                                     must not take the first one anywhere
#
# AN ASK WITH NO ENGINE LINE IS A FAILURE, NOT THE CLAIM, and it is the reading
# that makes this guard worth running. `ReportNewWindow` is shared with
# `CreateCustomWebContents`, so a run that saw only the shell's event would pass
# against a fork carrying #447 and no override at all -- which is the fork this
# change exists to improve on.
#
# HOW IT CAN FAIL, the other way. NEGATIVE=1 presses THE SAME POINT ON THE SAME
# LINK with the LEFT button. It must follow the link in the guest, in place, and
# ask the browser for nothing -- which separates "a middle click is routed and
# reported" from "this guest sends every press to its delegate". One link and
# one point means the button is the only thing that differs between the two
# runs, so a geometry error cannot masquerade as the claim.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-routed-link: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 presses the same link with the left button. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-routed-link-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-routed-link-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# The shell's own half of the window, in CSS pixels down from the top, and the
# three press points derived from it rather than written down -- so the strip,
# the window and the framed page's two halves cannot drift apart.
#
# NOT `STRIP`, WHICH IS A PROGRAM. This runs inside `nix develop .#full`, and
# that shell exports the toolchain's own names -- CC, LD, AR, STRIP.
# `${STRIP:-64}` in such a shell keeps `strip`, and the arithmetic below then
# dereferences it as a variable and dies under `set -u`, four hours into a job
# on the shared tree. `scripts/test-webview-guard-startup.sh` starts every guard
# here in that environment so the next one fails on this machine instead.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's page, which is one full-bleed link. ONE POINT, used
# by the run and by its control alike: the button is what differs between them,
# so a press that missed cannot look like a gesture that was ignored.
WINDOW_X=$((WIDTH / 2))
LINK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 2))

# How long the shell is given to load, ask for a guest, have one attached and
# navigated.
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its own negative control are two measurements, so they get two sets
# of logs. Sharing one file means the control's output overwrites the run's and
# the diagnostics print whichever went last -- which, when the two disagree, is
# exactly the pair worth reading side by side.
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

# Waits for `$2` to appear in `$3`, for `$1` quarter-seconds. Every gate in this
# script is a line in a log, because every one of them is something a page or a
# browser says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages: one server, two paths. Its own fixture rather than a real site,
#    for the reason the framing guard has one: `crux` reaches no arbitrary host.
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
#    WebViewGuestHost for that origin and no other.
#
#    No site-isolation flags and no resolver rule: this subject is one page on
#    one origin, and what decides it is the BUTTON rather than which process the
#    press came from. The version of this guard that needed both is in the
#    header, with the run that retired it.
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

# 3. There has to be a page in the window before a click in it means anything.
wait_for_line "$TRIES" "GUARD page-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# A press is routed by hit test, and a hit test is answered from the compositor
# frames the widgets have submitted. The line above says the page ran, which is
# not the same as its first frame having reached the browser, so a settle rather
# than a click at the moment a page spoke.
sleep 3

# 4. THE BEFORE. A press on the shell's own strip, which this document must
#    report -- and which is what turns the absences below into measurements: a
#    run where no click reaches this page at all reads exactly like a run where
#    one did and nothing was routed.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. THE CLICK THIS GUARD IS ABOUT: the MIDDLE button on the guest's one link --
#    or, in the control run, the LEFT button on the same point of the same link.
#    The button is the whole difference between the two runs.
BUTTON="middle"
[ "$NEGATIVE" = "1" ] && BUTTON="left"
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" --button "$BUTTON" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# The press is answered before it is handled: `Input.dispatchMouseEvent` comes
# back when the event has been forwarded, and what this reads is what the pages
# logged afterward. Long enough for the whole path: the guest's renderer, the
# browser, the delegate, the element's event, and an http page arriving.
#
# A fixed wait rather than a poll on the line that must appear, because the
# control's readings are ABSENCES, and an absence cannot be waited for -- it can
# only be given time.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_PAGE=$(saw "GUARD page-loaded")
SAW_PRESS=$(saw "GUARD page-mousedown")
# THE ENGINE'S OWN LINE, which is the reading no page can give and the one that
# tells this guard's claim from the thing that looks exactly like it. It is
# written by WebViewGuest::OpenURLFromTab's new-window arm, so it says the
# gesture reached THIS delegate rather than CreateNewWindow.
#
# NOT ReportNewWindow's LINE, and that distinction cost a crux cycle. That
# function is shared by both doors, so its line is true of a `target="_blank"`
# as well and cannot tell them apart. An earlier version of this guard grepped
# for the CURRENT_TAB arm's line instead, which a middle click never takes --
# the guard could not have passed whatever the engine did.
SAW_ROUTED=$(saw "domicile: a <webview> routed a second-window gesture")
# WHAT THE SHELL HEARD, which is the other half of the claim: an element that
# was told and dispatched the event, carrying the address the link names. The
# engine's line above says the delegate ran; this says the answer left it.
SAW_ASKED=$(saw "GUARD new-window url=$SITE/opened")
# AND WHETHER THE GUEST WENT THERE ITSELF, which a middle click must NOT do --
# and which is the control's positive reading, in the same file under the same
# name, because the two runs differ only in the button.
SAW_MOVED=$(saw "GUARD opened-loaded")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE button=$BUTTON"
echo "the shell's document saw: press=$SAW_CHROME asked=$SAW_ASKED"
echo "the browser process said: routed=$SAW_ROUTED"
echo "the page in the window saw: press=$SAW_PRESS moved=$SAW_MOVED"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgment. Eight
# readings and two modes make more answers than a person reading an annotation
# can be expected to reconstruct, and most of the failures read alike and mean
# different things -- so they are decided here, in a block
# `scripts/test-webview-routed-link-guard.sh` runs directly, rather than
# inferred from a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in: a run where the
# page never ran has established nothing, and a run with no cross-site frame in
# the window is not a run about a navigation the browser has to route.
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
sends the identical event, and a run reading only the shell's side would go \
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
ReportNewWindow, the mojom call or the element's event rather than the routing \
-- a user middle-clicking that link watches nothing happen, which is the same \
symptom as not being asked at all and a different fault. The engine's log has \
the disposition it was asked with"
else
  PASSED="a middle click on an ordinary link reached the guest's delegate, \
which refused to open the window itself and told the shell the address instead \
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
tail -40 "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
