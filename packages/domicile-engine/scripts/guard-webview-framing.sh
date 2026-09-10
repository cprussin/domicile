#!/usr/bin/env bash
# A site that refuses to be framed, on the page, in a <webview>.
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
# frame-ancestors, so that was most of the web. `BROWSER-WINDOW-PARITY.md` is
# the design that closes it, by putting a guest page behind the element instead
# of a subframe, and this is the assertion that it is closed.
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
# NEGATIVE=1 lays out an <iframe> in place of the <webview>, identically, on
# the same page pointed at the same URL. It MUST show nothing: a frame is a
# frame and the site refuses to be framed. So the pair separates "a guest is
# not being made" from "this harness cannot see a page at all", which are the
# two ways the positive run could be wrong and are indistinguishable from
# inside it.
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

# NEGATIVE=1 puts an <iframe> where the <webview> goes. See the header.
NEGATIVE="${NEGATIVE:-0}"
KIND="webview"
[ "$NEGATIVE" = "1" ] && KIND="iframe"

# The framing-refusing page's colour, and the shell page's own. Neither is any
# other guard's -- a colour two guards share is a colour a stale log can answer
# for -- and neither is a browser background, so a pixel that matches came from
# the page it belongs to.
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

# A run and its own negative control are two measurements, so they get two sets
# of logs. Sharing one file means the control's output overwrites the run's and
# the diagnostics print whichever went last -- which, when the two disagree, is
# exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-framing$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-framing$WHICH-http.log}"
PROBE_LOG="${PROBE_LOG:-/tmp/domicile-webview-framing$WHICH-probe.log}"

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
  skip "guard-webview-framing: no python3, and the framing-refusing page is served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# 1. The site that refuses to be framed. Its own server rather than a real
#    site: `crux` reaches no arbitrary host, and a guard whose subject could
#    change its headers is a guard that fails for reasons nobody chose.
python3 "$SCRIPTS/guard-webview-framing-server.py" \
  --port "$PORT" --colour "$COLOR" >"$HTTP_LOG" 2>&1 &
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
REFUSES="http://127.0.0.1:$PORT/refuses"
echo "serving a page that refuses framing at $REFUSES"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other -- a <webview> anywhere else
#    cannot ask for a guest at all. `--app` for the reason `domicile` uses it
#    and guard-shell.sh repeats: the guard runs the configuration the product
#    runs, or it is guarding something else.
#
#    Headless and software-composited. Neither the layout nor the compositing
#    of a guest needs a GPU, and the machine that runs this has no display.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?kind=$KIND&witness=$WITNESS&src=$REFUSES" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-framing.js" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-webview-framing: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER, showing a <$KIND>"

# 3. The pixels. One process, two colours: there is one producer per socket --
#    OutgoingInvitation::Send consumes the server endpoint -- so asking twice
#    is not available and the witness travels with the subject.
"$CHROMIUM/$OUT/domicile_colour_probe" \
  --domicile-broker-socket="$BROKER" \
  --colour="FF$COLOR" \
  --witness="FF$WITNESS" \
  --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
PROBE_STATUS="${PIPESTATUS[0]}"

echo
echo "the probe exited $PROBE_STATUS"

# WHICH END TO BLAME, and it is the whole of this script's judgement. Four
# statuses and two modes make eight answers, and six of them are failures that
# read alike and mean different things -- so they are decided here, in a block
# `scripts/test-webview-framing-guard.sh` runs directly, rather than inferred
# from a grep by whoever reads the annotation.
FAILURE=""
PASSED=""
case "$PROBE_STATUS" in
  0)
    if [ "$NEGATIVE" = "1" ]; then
      FAILURE="an <iframe> rendered the framing-refusing page, so nothing on \
this page is being refused and a <webview> showing it says nothing about \
guests. Check that the server still sends X-Frame-Options and CSP \
frame-ancestors, and that the page under test is actually framing it"
    else
      PASSED="a <webview> is showing a site that refuses to be framed, so its \
page is a guest's main frame and not a subframe"
    fi
    ;;
  1)
    if [ "$NEGATIVE" = "1" ]; then
      PASSED="the control is sharp: the same page in an <iframe> shows \
nothing, so the positive run is measuring the guest and not the harness"
    else
      FAILURE="the <webview> showed nothing. The page was drawn -- the witness \
colour is on it -- so this is the guest: either the element never asked for \
one, or the browser refused, or it was attached and the site refused framing \
anyway. The engine log has the page's own console and any bad-message kill"
    fi
    ;;
  2)
    FAILURE="nothing was measured: the shell page's own background never \
appeared, so the browser drew no page at all and neither answer above is \
available. This is the harness, not the element"
    ;;
  *)
    FAILURE="the probe did not run (it exited $PROBE_STATUS), so there is no \
measurement here of any kind"
    ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-framing: $FAILURE"
echo "the engine's last words:" >&2
tail -30 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
