#!/usr/bin/env bash
# A link with target="_blank" inside a browser window, and the second window it
# has to produce.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-new-window.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-click.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. Clicking such a link did nothing at all — no window, no
# error, nothing in the page to notice. The page in a browser window is a guest
# and a guest has no SiteInstance of its own, which is what keeps the user
# logged in and what content CHECKs against the WebContents in
# `WebContentsImpl::CreateNewWindow`; so `WebViewGuest` refuses the window
# content would have made, and for as long as that refusal was silent a shell
# had nothing to act on. It now reports the address, the element dispatches
# `domicile-new-window` carrying it, and the shell opens a browser window of its
# own — which is the layer that knows where a window goes.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   the shell page ran               or nothing here was ever set up
#   a press reached the shell's      the harness can deliver a click to this
#     document                        document at all. Without it, an absence
#                                     below is not a measurement
#   there is a page in the window    that a guest was made, attached, navigated
#   the press landed in the guest    measured in the window's own page: the hit
#                                     test crossed into it rather than stopping
#                                     at the element
#   the element asked for a window   THE CLAIM's first half: the browser's
#                                     refusal reached the page as an event
#   at the address the link named    the address survived the trip, rather than
#                                     an empty or a stale one arriving
#   a second view was made           the shell acted on it — this guard's own
#                                     page, and the step that separates "told"
#                                     from "opened"
#   the page it names then loaded    THE CLAIM's other half, and the one no
#                                     earlier step can fake: a guest was
#                                     created, attached and navigated for the
#                                     second element, so the user is looking at
#                                     the page the link named
#
# AN EVENT IS NOT A WINDOW, which is why the last two readings are here at all.
# A guard that stopped at `new-window url=…` would pass over a desktop where
# such a link still shows the user nothing — the event arriving and a second
# page being on the screen are different claims, in different processes.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM, and the shell's own tests say why by what
# they can do: `BrowserWindow.test.tsx` dispatches the event itself and asserts
# the desktop opens a window for it, which passes whether or not anything real
# ever sends one. There is no guest in happy-dom and no browser process to
# refuse a window. Only a real engine can be asked whether a `target="_blank"`
# produces the event at all.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without.
# NEGATIVE=1 clicks the OTHER half of the same page: an ordinary link, in the
# same guest, followed by the same kind of press. It must ask for no window and
# must navigate where it points — which separates "a `target="_blank"` asks for
# a window" from "this element announces one for any click, any navigation, or
# the attach itself", the second of which would pass the positive run while
# measuring nothing about the link.
#
# NOT A CLICK ON THE SHELL'S OWN STRIP, which is the click guard's control and
# too weak here: a press that reaches no guest at all would leave the element
# silent for reasons that have nothing to do with windows. The control has to
# land in the page, on a link, and differ from the subject in one attribute.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-new-window: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 clicks the ordinary link instead of the `_blank` one. See header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-new-window-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-new-window-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# The shell's own half of the window, in CSS pixels down from the top, and the
# three press points derived from it rather than written down — so the strip,
# the window and the two links cannot drift apart.
#
# NOT `STRIP`, WHICH IS A PROGRAM. This runs inside `nix develop .#full`, and
# that shell exports the toolchain's own names — CC, LD, AR, STRIP.
# `${STRIP:-64}` in such a shell keeps `strip`, and the arithmetic below then
# dereferences it as a variable and dies under `set -u`, four hours into a job
# on the shared tree. `scripts/test-webview-guard-startup.sh` starts every guard
# here in that environment so the next one fails on this machine instead.
STRIP_HEIGHT="${STRIP_HEIGHT:-64}"
CHROME_X=$((WIDTH / 2))
CHROME_Y=$((STRIP_HEIGHT / 2))
# The middle of the guest's top half, which the fixture fills with the
# `target="_blank"` link, and the middle of its bottom half, which the ordinary
# one fills. Quarters of what is left under the strip, so neither point is
# within a rounding error of the seam between them.
WINDOW_X=$((WIDTH / 2))
BLANK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 4))
SAME_Y=$((STRIP_HEIGHT + 3 * (HEIGHT - STRIP_HEIGHT) / 4))

# How long the shell is given to load, ask for a guest, have one attached and
# navigated. Generous, because every one of those is asynchronous and this
# machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its own negative control are two measurements, so they get two sets
# of logs. Sharing one file means the control's output overwrites the run's and
# the diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
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

# 1. The pages: the one in the window, and the two its links lead to. Their own
#    server rather than a real site, for the reason the framing guard has one:
#    `crux` reaches no arbitrary host.
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
#    WebViewGuestHost for that origin and no other. `--app` for the reason
#    `domicile` uses it and every guard here repeats: the guard runs the
#    configuration the product runs, or it is guarding something else.
#
#    `--remote-debugging-port` is how the click gets in. There is no pointer on
#    this machine; see guard_webview_devtools.py for why the path it takes is
#    the one the platform's own press would take.
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
  exit 1
}
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-webview-new-window: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. There has to be a page in the window before a click in it means anything.
wait_for_line "$TRIES" "GUARD opener-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# A press is routed by hit test, and a hit test is answered from the compositor
# frames the widgets have submitted. The line above says the guest's page ran,
# which is not the same as its first frame having reached the browser — so a
# settle, rather than clicking at the moment the page spoke.
sleep 3

# 4. THE BEFORE. A press on the shell's own strip, which this document must
#    report — and which is what turns the absences below into measurements: a
#    run where no click reaches this page at all reads exactly like a run where
#    one did and nothing was asked for.
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$CHROME_X" --y "$CHROME_Y" \
  >"$CLICK_LOG" 2>&1 ||
  echo "the first click could not be driven; see $CLICK_LOG" >&2

wait_for_line 20 "GUARD chrome-mousedown" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first click" >&2

# 5. THE CLICK THIS GUARD IS ABOUT: the `target="_blank"` link in the top half
#    of the page — or, in the control run, the ordinary link in the bottom half.
#    One press either way, in the same guest, differing in which link is under
#    it.
LINK_Y="$BLANK_Y"
[ "$NEGATIVE" = "1" ] && LINK_Y="$SAME_Y"
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# The press is answered before it is handled: `Input.dispatchMouseEvent` comes
# back when the event has been forwarded, and what this reads is what the pages
# logged afterward. Long enough for a whole second window: the event, the
# element the shell makes, a guest for it, and an http page arriving in it.
#
# A fixed wait rather than a poll on the line that must appear, because the
# control's readings are ABSENCES, and an absence cannot be waited for — it can
# only be given time.
sleep 10

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD opener-loaded")
SAW_CHROME=$(saw "GUARD chrome-mousedown")
SAW_GUEST=$(saw "GUARD guest-mousedown")
SAW_ASKED=$(saw "GUARD new-window url=")
# The address as well as the ask, and as one string: an event carrying the
# wrong address opens a window at the wrong page, which is a defect that reads
# like a pass everywhere else in this script.
SAW_ADDRESS=$(saw "GUARD new-window url=$SITE/opened")
SAW_SECOND=$(saw "GUARD second-view")
SAW_OPENED=$(saw "GUARD opened-loaded")
# The control's own positive reading: the ordinary link was followed, in the
# window it was clicked in. Read in the claim's run too, where it means the
# press landed on the wrong link.
SAW_STAYED=$(saw "GUARD stayed-loaded")
# AND THE BROWSER'S OWN LINE, which is the reading no listener in a page can
# give. It is written by WebViewGuest::CreateCustomWebContents, so it separates
# "the renderer never asked the browser for a window" from "it asked, the
# browser refused it as it must, and nothing came back to the page" — two
# faults in two processes that look identical from the shell's document.
SAW_REFUSED=$(saw "domicile: a <webview> refused to open a window for")

echo
echo "shell=$SAW_SHELL page=$SAW_PAGE"
echo "the shell's document saw: press=$SAW_CHROME asked=$SAW_ASKED address=$SAW_ADDRESS second=$SAW_SECOND"
echo "the browser process said: refused=$SAW_REFUSED"
echo "the pages in the windows saw: press=$SAW_GUEST opened=$SAW_OPENED stayed=$SAW_STAYED"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgment. Ten
# readings and two modes make more answers than a person reading an annotation
# can be expected to reconstruct, and most of the failures read alike and mean
# different things — so they are decided here, in a block
# `scripts/test-webview-new-window-guard.sh` runs directly, rather than inferred
# from a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in: a run where the
# page never ran has established nothing, and a run where no press landed in the
# guest is not a run about what a link in it does.
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
was clicked and the element announced a new window anyway, so what the \
positive run reads is not the link's target: it is this element \
announcing one for any click, any navigation, or the attach itself"
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
must — and no event reached this document. So the crossing works and the \
report does not: NewWindowRequested on WebViewGuestClient, the dispatch in \
HTMLWebViewElement, or the name the engine dispatches against the one this \
page listens for, of which WEBVIEW_NEW_WINDOW_EVENT in the SDK is the third \
copy"
elif [ "$SAW_ASKED" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: a press landed on the link and \
WebContentsImpl::CreateNewWindow never reached this guest's delegate. So the \
renderer did not ask for a window at all — the link's target did not survive \
the page, the navigation was swallowed before it became a window request, or \
the press did not land on the anchor it looks like it did. The engine log is \
where this starts, and the http log says which pages were asked for"
elif [ "$SAW_ADDRESS" != "1" ]; then
  FAILURE="THE WINDOW WAS ASKED FOR AT THE WRONG ADDRESS: an event arrived \
and it does not carry the address the link names. A window opened at the wrong \
page is worse than none — see the reported url above. The address is resolved \
in the browser process and crosses as a url.mojom.Url, so an empty or relative \
one arriving here is that crossing"
elif [ "$SAW_SECOND" != "1" ]; then
  FAILURE="the shell was told and opened nothing: this guard's own page heard \
the event and made no second <webview>. That is this script's page rather than \
the engine — see guard-webview-new-window.js, which appends the element in the \
handler"
elif [ "$SAW_OPENED" != "1" ]; then
  FAILURE="AN EVENT AND NO WINDOW, WHICH IS THE FAILURE THIS GUARD EXISTS TO \
SEPARATE FROM A PASS: the element asked, the shell made a second <webview> at \
the right address, and the page never arrived in it. So the second element got \
no guest, or one that was never attached or never navigated — a user clicking \
that link sees an empty window. The engine's own attach line and the http log's \
record of whether /opened was ever requested are the two ends of it"
else
  PASSED="a link with target=\"_blank\", clicked inside a browser window, \
reached the shell as domicile-new-window carrying the address it names — and \
the second <webview> the shell opened for it loaded that page. Which is the \
whole of what a user asking for a new window gets, measured end to end"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-new-window: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the clicks did:" >&2
tail -20 "$CLICK_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
