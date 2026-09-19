#!/usr/bin/env bash
# A link the browser has to route, clicked inside a browser window.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-routed-link.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-click.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. Not every navigation a page asks for is one its own renderer
# can perform. A link inside a frame from ANOTHER SITE lives in another process,
# and `target="_top"` asks it to navigate the page around it -- which it cannot
# touch. Blink hands that to the browser, which arrives at
# `WebContentsDelegate::OpenURLFromTab`. content's default implementation
# returns null and does nothing at all, so for as long as `WebViewGuest` did not
# override it, such a link was a click that did NOTHING: no window, no error,
# nothing in any page to notice. Sign-in flows are full of them -- a consent or
# account frame from another origin, navigating the window it sits in -- which
# is how this was found.
#
# NOT THE SAME HOLE AS guard-webview-new-window.sh, and the two are worth
# keeping apart: that one is `WebContentsImpl::CreateNewWindow`, which asks for
# a SECOND window and which a guest must refuse; this one is a navigation of the
# window that already exists, which the guest should simply perform.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   the shell page ran               or nothing here was ever set up
#   a press reached the shell's      the harness can deliver a click to this
#     document                        document at all. Without it, an absence
#                                     below is not a measurement
#   there is a page in the window    that a guest was made, attached, navigated
#   a frame from another site        the experiment exists at all: same-process
#     loaded inside it                and Blink retargets the link itself
#   the press landed in the frame    measured in the frame's own page: the hit
#                                     test crossed into the guest AND into the
#                                     frame inside it
#   the browser was asked            THE CLAIM's first half, read off the
#                                     engine's own log: OpenURLFromTab ran on
#                                     the guest with a current-tab disposition
#   the window went there            THE CLAIM's other half: the page the link
#                                     names is now the TOP document of the
#                                     guest, which it says of itself
#
# A TOP THAT MOVED WITH NO ASK IS A FAILURE, NOT THE CLAIM, and it is the one
# reading that makes this guard worth running. If the frame ends up in the same
# process -- site isolation off, the resolver rule not applied, both pages under
# one host -- Blink retargets the navigation itself, the top moves, and the
# delegate under test is never on the path. A guard that read only "the top
# moved" would pass against a fork with no override at all.
#
# AND THIS RUN SETTLES THE PREMISE AS WELL AS THE FIX, which is worth saying
# because the premise was reasoned rather than read. A `target="_top"` from a
# cross-process frame is handed to the browser; WHERE the browser then performs
# it -- at this delegate, or inside `Navigator::NavigateFromFrameProxy` without
# asking anyone -- is a detail of the pin that this repository cannot check,
# because it holds no Chromium source and `crux` is the only machine that does.
# So `routed=0 top=1` is not a broken guard: it is this gesture answering that
# it never reaches a delegate at all, and the subject has to move to one that
# does -- a middle click, or a `_blank` inside the same frame. The verdict block
# says so rather than blaming the fixture alone.
#
# HOW IT CAN FAIL, the other way. NEGATIVE=1 clicks the OTHER half of the framed
# page: an ordinary link, in the same frame, followed by the same kind of press.
# It must navigate the FRAME and leave the window where it was, and it must ask
# the browser for nothing -- which separates "a `_top` link is routed and
# performed" from "this guest routes or retargets any link at all".
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-routed-link: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 clicks the link that stays in the frame. See the header.
NEGATIVE="${NEGATIVE:-0}"

# Not spike-iframe.sh's 8730, the framing guard's 8731, the keyboard guard's
# 8732, the history guard's 8733, the click guard's 8734 or the new-window
# guard's 8735: two guards on one port is two guards that cannot run in the same
# job, and CI runs them in one.
PORT="${PORT:-8736}"
DEBUG_PORT="${DEBUG_PORT:-9235}"

# The two names the fixture is served under, and the whole reason this guard
# measures anything: a site is a scheme and a registrable domain, so `a.test`
# and `b.test` are different sites and site isolation puts them in different
# processes. Two PORTS of one host would not be -- a port is not part of a site
# -- and the frame would share the page's process, where Blink retargets a
# `_top` link itself and the browser is never asked.
OUTER_HOST="${OUTER_HOST:-a.test}"

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
# The middle of the framed page's top half, which holds the `_top` link, and the
# middle of its bottom half, which holds the ordinary one. The frame fills the
# window's page, so the page's halves are the window's halves under the strip.
WINDOW_X=$((WIDTH / 2))
TOP_LINK_Y=$((STRIP_HEIGHT + (HEIGHT - STRIP_HEIGHT) / 4))
SAME_LINK_Y=$((STRIP_HEIGHT + 3 * (HEIGHT - STRIP_HEIGHT) / 4))

# How long the shell is given to load, ask for a guest, have one attached and
# navigated -- and then for a frame from another site to load inside that.
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

# 1. The pages: one server, two hostnames, four paths. Its own fixture rather
#    than a real site, for the reason the framing guard has one: `crux` reaches
#    no arbitrary host.
python3 "$SCRIPTS/guard-webview-routed-link-server.py" --port "$PORT" \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-routed-link: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SITE="http://$OUTER_HOST:$PORT"
echo "serving a page framing another site at $SITE/outer"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other.
#
#    `--host-resolver-rules` is what makes `a.test` and `b.test` reach the
#    fixture, and `--site-per-process` is what makes them two processes rather
#    than a hope: full site isolation is the desktop default, and this guard's
#    whole subject is a frame in another process, so it is stated rather than
#    assumed.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --site-per-process \
  --host-resolver-rules="MAP *.test 127.0.0.1" \
  --app="domicile://shell/?strip=$STRIP_HEIGHT&src=$SITE/outer" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-routed-link.js" \
  --remote-debugging-port="$DEBUG_PORT" \
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
echo "the shell is up, with a <webview> under a ${STRIP_HEIGHT}px strip"

# 3. There has to be a page in the window, and a frame inside that page, before
#    a click in it means anything.
wait_for_line "$TRIES" "GUARD outer-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2
wait_for_line "$TRIES" "GUARD inner-loaded" "$ENGINE_LOG" ||
  echo "the frame from the other site never loaded" >&2

# A press is routed by hit test, and a hit test is answered from the compositor
# frames the widgets have submitted -- of which there are now three, the frame's
# among them. The lines above say the pages ran, which is not the same as their
# first frames having reached the browser, so a settle rather than a click at
# the moment a page spoke.
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

# 5. THE CLICK THIS GUARD IS ABOUT: the `target="_top"` link in the top half of
#    the framed page -- or, in the control run, the ordinary link in its bottom
#    half. One press either way, in the same frame, differing in what the link
#    under it asks for.
LINK_Y="$TOP_LINK_Y"
[ "$NEGATIVE" = "1" ] && LINK_Y="$SAME_LINK_Y"
python3 "$SCRIPTS/guard-webview-click-mouse.py" \
  --port "$DEBUG_PORT" --x "$WINDOW_X" --y "$LINK_Y" \
  >>"$CLICK_LOG" 2>&1 ||
  echo "the click into the window could not be driven; see $CLICK_LOG" >&2

# The press is answered before it is handled: `Input.dispatchMouseEvent` comes
# back when the event has been forwarded, and what this reads is what the pages
# logged afterward. Long enough for the whole path: the frame's renderer, the
# browser, a navigation across processes, and an http page arriving.
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
SAW_OUTER=$(saw "GUARD outer-loaded")
SAW_INNER=$(saw "GUARD inner-loaded")
SAW_PRESS=$(saw "GUARD inner-mousedown")
# THE ENGINE'S OWN LINE, which is the reading no page can give and the one that
# tells this guard's claim from the thing that looks exactly like it. It is
# written by WebViewGuest::OpenURLFromTab, so it says the navigation left the
# frame's renderer and reached the guest's delegate -- rather than Blink having
# retargeted it in one process, which moves the top just the same and measures
# nothing.
SAW_ROUTED=$(saw "domicile: a <webview> followed a link its page could not")
# AND WHERE IT LANDED, as the page itself reports: `top` when it replaced the
# whole window, `framed` when it only replaced the frame. The pair is what makes
# a `_top` that was ignored -- the target page loading inside the frame -- read
# as a failure rather than as the claim.
SAW_TOP=$(saw "GUARD top-arrived top")
SAW_STAYED=$(saw "GUARD inner-stayed framed")

echo
echo "shell=$SAW_SHELL page=$SAW_OUTER frame=$SAW_INNER"
echo "the shell's document saw: press=$SAW_CHROME"
echo "the browser process said: routed=$SAW_ROUTED"
echo "the pages in the window saw: press=$SAW_PRESS top=$SAW_TOP stayed=$SAW_STAYED"
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
elif [ "$SAW_OUTER" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no page to hold a \
frame and no link under the press. That is the guest: it was not made, not \
attached, or not navigated. The engine's log has the browser's own line for an \
attach, and the http log says whether the page was ever asked for"
elif [ "$SAW_INNER" != "1" ]; then
  FAILURE="the cross-site frame never loaded, so there was nothing in another \
process and nothing for the browser to route. This is the fixture rather than \
the element: the resolver rule has to map both hostnames to the server, and \
the http log says which hosts were actually asked for"
elif [ "$SAW_PRESS" != "1" ]; then
  FAILURE="the press never reached the framed page: it was hit-tested to the \
page around it, or to nothing. That is this harness or the element's box \
rather than anything about routing -- what a link does is only asked once a \
press has landed on one"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_TOP" = "1" ]; then
    FAILURE="the control moved the whole window. An ordinary link -- no target \
-- was clicked and the window went with it, so what the positive run reads is \
not the target: this guest sends any link in a frame to the top, which is worse \
than the hole this guard is about"
  elif [ "$SAW_ROUTED" = "1" ]; then
    FAILURE="the control's link reached the browser. A navigation that stays \
in the frame that asked for it has no business at the guest's delegate, so a \
run where it arrives there says the positive reading is this element routing \
everything rather than routing what Blink could not do itself"
  elif [ "$SAW_STAYED" != "1" ]; then
    FAILURE="the control's press followed no link: the framed page never \
navigated to the address the ordinary link names. So the absence above is not \
a measurement -- a press that lands on nothing asks for nothing whatever the \
delegate does. This is geometry: the halves of the framed page and the two \
press points are both derived from the window's size"
  else
    PASSED="the control is sharp: an ordinary link in the same frame, clicked \
the same way, navigated that frame and left the window where it was, and the \
browser was never asked. So what the positive run reads is the link's target \
and not the configuration"
  fi
elif [ "$SAW_ROUTED" != "1" ] && [ "$SAW_TOP" = "1" ]; then
  FAILURE="THE WINDOW MOVED AND THE BROWSER WAS NEVER ASKED, which is this \
guard measuring nothing rather than the claim, and which has two causes worth \
telling apart. Either the frame was in the same process as the page around it \
-- then Blink retargeted the link itself, and site isolation is the thing to \
check: the run passes --site-per-process and maps a.test and b.test, and the \
http log says which hosts were served. Or the frame really was remote and this \
pin performs such a navigation inside Navigator::NavigateFromFrameProxy \
without asking any delegate -- then the override is still right and this \
gesture is simply not the one that exercises it, and the subject must move to \
one that does: a middle click, or a target=_blank inside the same frame. The \
http log tells them apart: two hosts served means the frame was remote"
elif [ "$SAW_TOP" != "1" ] && [ "$SAW_STAYED" = "1" ]; then
  FAILURE="the press landed on the WRONG LINK: the frame followed the ordinary \
link, which is the control's target and sits in the other half of the framed \
page. Nothing here is about a routed navigation -- this is geometry, and the \
press points and the page's halves are both derived from the window's size"
elif [ "$SAW_TOP" != "1" ] && [ "$SAW_ROUTED" != "1" ]; then
  FAILURE="THE BROWSER WAS NEVER ASKED: a press landed on a link that no \
renderer can follow by itself, and nothing reached the guest's delegate. So \
the navigation died between the frame and the browser, or it reached a \
WebContentsDelegate that does not override OpenURLFromTab -- which is content's \
default, returning null and doing nothing, and is exactly the hole this guard \
exists for"
elif [ "$SAW_TOP" != "1" ]; then
  FAILURE="THE DELEGATE TOOK IT AND NOTHING ARRIVED: the browser was asked and \
the page the link names never became the window's document. So the navigation \
was started and did not commit, or it was started somewhere other than the \
guest -- a user clicking that link watches nothing happen, which is the same \
symptom as not being asked at all and a different fault. The engine's log has \
the disposition it was asked with, and the http log says whether the target was \
ever fetched"
else
  PASSED="a link in a frame from another site, targeting the window around it, \
reached the guest's delegate and took the window there -- the page it names is \
now the top document of the browser window. Which is what a user clicking a \
sign-in frame's link gets, measured end to end, with the browser's own line \
saying the navigation really was routed rather than retargeted in one process"
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
