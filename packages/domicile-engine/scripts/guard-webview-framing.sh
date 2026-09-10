#!/usr/bin/env bash
# A site that refuses to be framed, on the page, in a <domicile-webview>.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-framing.sh /build/chromium/src
#
# No nested compositor and no Wayland client, unlike every other pixel guard
# here: what this measures is a page against itself, so `--ozone-platform=
# headless` with software compositing is the whole of the environment. That is
# `guard-css-and-resize.sh`'s configuration, and it runs under Domicile's full
# shell because that is where Chromium's runtime libraries are.
#
# WHY THIS EXISTS. `ENGINE-FORK.md`'s patch 0007 shipped <webview> as a frame
# owner and named the cost in the same breath: "a site that refuses framing
# refuses to load -- that is the one thing Electron's guest-view <webview>
# bought that this does not." Most of the web sends X-Frame-Options or CSP
# frame-ancestors, so that was most of the web. A guest page behind the element
# instead of a subframe is what closes it -- see `web_view_guest.h` -- and this
# is the assertion that it is closed.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM. There is no nested browsing context in
# jsdom, no ancestor for a header to be checked against, and no pixels. The
# claim is "the page is on the screen", and the only thing that can say so is a
# real engine drawing it.
#
# WHAT IT ASSERTS. That the framed page's flat colour is somewhere in the
# browser's window. Not where: the element's box is this guard's own CSS and
# asserting a coordinate would be asserting that, which is not the question.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without.
# NEGATIVE=1 runs the control, and the control is two runs rather than one:
#
#   1. an <iframe> on an ordinary http page, framing `/permits`. It MUST show
#      the colour. Nothing about the element is being tested here -- this is
#      the run that establishes that a framed page can reach the screen at all
#      in this harness, in this position.
#   2. the same frame on the same page, framing `/refuses`. It MUST show
#      nothing.
#
# The two framed pages are the same bytes in the same colour and differ only in
# X-Frame-Options and frame-ancestors, so the difference between the runs is a
# reading of those headers and of nothing else. That is what the positive run
# needs from a control and cannot get from inside itself: that the site really
# is refused where it has an ancestor, and that a <webview> shows it anyway.
#
# THE CONTROL THIS REPLACES MEASURED NOTHING, and it looked exactly like this
# one. It put the <iframe> on the guard's own domicile:// document, pointed it
# at `/refuses`, and required an empty box -- which it always got, because an
# <iframe> on a domicile:// document does not load an http page at all.
# `guard-webview-keyboard.sh` found that and wrote it down; the same fact had
# been quietly holding this control up. It would have gone on passing with both
# headers deleted from the fixture, which is the one thing a negative control
# must not do. The lesson is that guard's: a run that measures only an absence
# proves nothing, because "nothing happened" and "the harness is broken" are
# the same reading -- so establish a presence first, and let the absence be the
# difference between them.
#
# The witness colour is the same separation one layer down. The probe has to
# find the page's own background before "the framed colour is absent" is a
# measurement rather than a browser that never drew; see engine_colour_probe.cc.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-framing: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control's two legs instead of the claim. See the header.
NEGATIVE="${NEGATIVE:-0}"

# The framed page's colour, and the colour of whichever page is doing the
# framing. Neither is any other guard's -- a colour two guards share is a
# colour a stale log can answer for -- and neither is a browser background, so
# a pixel that matches came from the page it belongs to.
COLOR="${COLOR:-D81B60}"
WITNESS="${WITNESS:-20304A}"

# Not spike-iframe.sh's 8730: two guards on one port is two guards that cannot
# run at the same time, and CI runs them in one job.
PORT="${PORT:-8731}"

# How long the probe looks. Long enough for a browser to start, load a page,
# ask for a guest, have one attached and navigated, and paint it.
FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-framing-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-framing-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-framing-http.log}"

# Set by `measure`, and read by the diagnostics at the foot: with three
# possible runs in one script, "the engine's last words" has to name which
# engine. Sharing one file would mean the second leg's output overwriting the
# first's and the diagnostics printing whichever went last -- which, when the
# two disagree, is exactly the pair worth reading side by side.
LAST_ENGINE_LOG=""

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-framing: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_colour_probe" ] || {
  annotate "guard-webview-framing: no domicile_colour_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-framing: no python3, and the pages this measures are served by one"
  exit 77
}

# One browser, one page, one answer: starts the engine on `$2`, waits for it to
# open the socket the probe reads pixels through, asks for the colour, and
# returns the probe's own status. `$1` names the run, in the logs and in the
# annotation, because three of these can happen in one invocation.
#
# The engine is killed on the way out rather than left to `cleanup`: the next
# leg opens the same socket, and a window still up from the last one is a
# second answer to the question this one is asking.
measure() { # $1 which run, $2 the URL to open
  local which="$1" url="$2"
  local engine_log="/tmp/domicile-webview-framing-$which-engine.log"
  local probe_log="/tmp/domicile-webview-framing-$which-probe.log"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  # `--app` for the reason `domicile` uses it and guard-shell.sh repeats: the
  # guard runs the configuration the product runs, or it is guarding something
  # else. Headless and software-composited, because neither the layout nor the
  # compositing of a guest needs a GPU and the machine that runs this has no
  # display.
  #
  # The shell's root and module are passed whatever the URL is, so that the
  # runs differ in the URL and in nothing else. They are what a domicile://
  # document is served out of; an http one ignores them.
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="$url" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-framing.js" \
    --no-sandbox --password-store=basic --no-first-run \
    --user-data-dir="$PROFILE" \
    --window-size="$WIDTH,$HEIGHT" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$engine_log" 2>&1 &
  local engine=$!
  STARTED+=("$engine")

  for _ in $(seq 1 240); do
    [ -S "$BROKER" ] && break
    sleep 0.5
  done
  [ -S "$BROKER" ] || {
    annotate_from "guard-webview-framing: the engine never opened its broker socket at $BROKER for the $which run" "$engine_log"
    echo "the engine said:" >&2
    tail -20 "$engine_log" >&2
    exit 1
  }
  echo "the engine is listening on $BROKER, showing $url"

  # One process, two colours: there is one producer per socket --
  # OutgoingInvitation::Send consumes the server endpoint -- so asking twice is
  # not available and the witness travels with the subject.
  "$CHROMIUM/$OUT/domicile_colour_probe" \
    --domicile-broker-socket="$BROKER" \
    --colour="FF$COLOR" \
    --witness="FF$WITNESS" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$probe_log"
  local status="${PIPESTATUS[0]}"

  kill "$engine" 2>/dev/null
  echo
  echo "the $which probe exited $status"
  return "$status"
}

# 1. The pages. Their own server rather than a real site: `crux` reaches no
#    arbitrary host, and a guard whose subject could change its headers is a
#    guard that fails for reasons nobody chose.
python3 "$SCRIPTS/guard-webview-framing-server.py" \
  --port "$PORT" --colour "$COLOR" --witness "$WITNESS" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$HTTP_LOG" 2>/dev/null || {
  annotate_from "guard-webview-framing: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page that refuses framing at $SITE/refuses"

# 2. The runs. The claim is one; the control is two, and the order is the
#    experiment rather than a convenience -- the second leg's absence is only a
#    reading because the first leg's presence came first.
#
#    The claim's page is a domicile:// document because the browser binds
#    WebViewGuestHost for that origin and no other: a <webview> anywhere else
#    cannot ask for a guest at all. The control's is an ordinary http one
#    because that is what can frame an http page, which is the whole of what
#    the old control got wrong.
if [ "$NEGATIVE" = "1" ]; then
  measure permitted "$SITE/frames?src=/permits"
  PERMITTED_STATUS=$?
  measure refused "$SITE/frames?src=/refuses"
  REFUSED_STATUS=$?
  MEASURED="control $PERMITTED_STATUS $REFUSED_STATUS"
else
  measure webview "domicile://shell/?witness=$WITNESS&src=$SITE/refuses"
  MEASURED="webview $?"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME, and it is the whole of this script's judgement. Eleven
# answers, and most of them are failures that read alike and mean different
# things -- so they are decided here, in a block
# `scripts/test-webview-framing-guard.sh` runs directly, rather than inferred
# from a grep by whoever reads the annotation.
#
# One `case` over the whole of what a run measured, rather than a status and a
# mode in separate variables, because the control is one decision and not two:
# its second leg means nothing without its first, and a table says that where
# nested conditionals would only imply it.
FAILURE=""
PASSED=""
case "$MEASURED" in
"webview 0")
  PASSED="a <webview> is showing a site that refuses to be framed, so its \
page is a guest's main frame and not a subframe"
  ;;
"webview 1")
  FAILURE="the <webview> showed nothing. The page was drawn -- the witness \
colour is on it -- so this is the guest: either the element never asked for \
one, or the browser refused, or it was attached and the site refused framing \
anyway. The engine log has the page's own console and any bad-message kill"
  ;;
"webview 2")
  FAILURE="nothing was measured: the shell page's own background never \
appeared, so the browser drew no page at all and neither answer above is \
available. This is the harness, not the element"
  ;;
"webview "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 0 1")
  PASSED="the control is sharp: an <iframe> on an ordinary page showed the \
framable copy and not the refusing one, and the two differ only in their \
framing headers -- so the site really is refused where it has an ancestor, \
and the positive run is measuring the guest rather than the harness"
  ;;
"control 0 0")
  FAILURE="an <iframe> rendered the framing-refusing page, having also \
rendered the framable one it is supposed to differ from -- so nothing on that \
page is being refused and a <webview> showing it says nothing about guests. \
Check that the server still sends X-Frame-Options and CSP frame-ancestors on \
/refuses and neither on /permits"
  ;;
"control 0 2")
  FAILURE="the refusing leg measured nothing: its own framing page never \
drew, so the frame being empty is not a reading. This is the harness, and the \
leg before it worked"
  ;;
"control 0 "*)
  FAILURE="the probe did not run for the control's refusing leg ($MEASURED), \
so the control established that a framed page can be seen here and then \
measured nothing against it"
  ;;
"control 1 "*)
  FAILURE="the control's first leg showed nothing: a page that permits \
framing did not appear in the <iframe> that is supposed to be able to show \
it. So this harness cannot put a framed page on the screen at all, whatever \
the second leg then found, and an empty frame proves nothing. The engine log \
for the permitted run is where this starts"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the control's own framing page never \
appeared, so the browser drew no page at all. This is the harness, not the \
headers"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the probe \
did not run, or ran for something this guard does not know how to read"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-framing: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  tail -30 "$LAST_ENGINE_LOG" >&2
fi
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
