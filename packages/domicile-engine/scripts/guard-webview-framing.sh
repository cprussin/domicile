#!/usr/bin/env bash
# Guard: a site that refuses framing still shows in a <webview>.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-framing.sh /build/chromium/src
#
# Runs headless with software compositing, like `guard-css-and-resize.sh`, under
# the full dev shell for Chromium's runtime libraries.
#
# Most sites send X-Frame-Options or CSP frame-ancestors. A <webview> shows its
# page as a guest main frame rather than a subframe (see `web_view_guest.h`), so
# those headers do not apply. A unit test cannot check this: jsdom has no
# nested browsing context and no pixels.
#
# Asserts the framed page's color appears somewhere in the window, not where.
#
# NEGATIVE=1 runs the control, two runs in order:
#
#   1. an <iframe> on an http page framing `/permits`. Must show the color,
#      proving a framed page can reach the screen in this harness.
#   2. the same, framing `/refuses`. Must show nothing.
#
# The two pages differ only in the headers, so the control proves the site is
# refused where it has an ancestor. The control cannot use the domicile://
# shell: an <iframe> there never loads http pages, so it would always be empty.
#
# The probe must also find the witness color, so an absent color means the
# page drew without it; see engine_color_probe.cc.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-framing: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"

# The framed page's color and the framing page's color. Unique to this guard
# and unlike any browser background, so a match comes from the right page.
COLOR="${COLOR:-D81B60}"
WITNESS="${WITNESS:-20304A}"

# How long the probe looks: enough to start, attach a guest, navigate and
# paint.
FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-framing-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-framing-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-framing-http.log}"

# Set by `measure` so the diagnostics print the last run's log. Each run has
# its own log so runs do not overwrite each other.
LAST_ENGINE_LOG=""

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-framing: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-webview-framing: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-framing: no python3, and the pages this measures are served by one"
  exit 77
}

# Starts the engine on `$2`, runs the color probe against it and returns the
# probe's status. `$1` names the run in logs and annotations.
#
# Kills the engine before returning, since the next run reuses the socket.
measure() { # $1 which run, $2 the URL to open
  local which="$1" url="$2"
  local engine_log="/tmp/domicile-webview-framing-$which-engine.log"
  local probe_log="/tmp/domicile-webview-framing-$which-probe.log"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  # `--app` matches how `domicile` runs it. The shell flags are passed for every
  # URL so runs differ only in the URL; an http page ignores them.
  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="$url" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-framing.js" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
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

  # One probe checks both colors: OutgoingInvitation::Send consumes the server
  # endpoint, so a socket serves only one probe.
  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$CHROMIUM/$OUT/domicile_color_probe" \
      --domicile-broker-socket="$BROKER" \
      --color="FF$COLOR" \
      --witness="FF$WITNESS" \
      --for-seconds="$FOR_SECONDS" 2>&1 | tee "$probe_log"
  local status="${PIPESTATUS[0]}"

  kill "$engine" 2>/dev/null
  echo
  echo "the $which probe exited $status"
  return "$status"
}

# 1. Serve the pages locally; `crux` cannot reach external hosts, and a real
#    site could change its headers.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-framing-server.py" \
  --port 0 --color "$COLOR" --witness "$WITNESS" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$HTTP_LOG" 2>/dev/null || {
  annotate_from "guard-webview-framing: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-framing: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "serving a page that refuses framing at $SITE/refuses"

# 2. Run. The positive run uses a domicile:// page, the only origin
#    WebViewGuestHost is bound for. The control uses an http page, which can
#    frame http pages. The control's order matters: the absence in the second
#    run only means something after the first shows a presence.
if [ "$NEGATIVE" = "1" ]; then
  # `refused` waits for an absence, so it runs its full timeout. Its timeout
  # is derived from how long `permitted` took to show its color.
  LEG_STARTED="$(date +%s)"
  measure permitted "$SITE/frames?src=/permits"
  PERMITTED_STATUS=$?

  # Only on a pass: a failed run's duration is just the timeout.
  if [ "$PERMITTED_STATUS" -eq 0 ]; then
    budget_note webview-framing "$(($(date +%s) - LEG_STARTED))"
  fi

  FOR_SECONDS="$(budget_for webview-framing "$FOR_SECONDS")" \
    measure refused "$SITE/frames?src=/refuses"
  REFUSED_STATUS=$?
  MEASURED="control $PERMITTED_STATUS $REFUSED_STATUS"
else
  measure webview "domicile://shell/?witness=$WITNESS&src=$SITE/refuses"
  MEASURED="webview $?"
fi

echo
echo "measured: $MEASURED"

# Turn the statuses into a verdict. `scripts/test-webview-framing-guard.sh`
# tests this block. One `case` over both control statuses, because the second
# means nothing without the first.
FAILURE=""
PASSED=""
case "$MEASURED" in
"webview 0")
  PASSED="a <webview> is showing a site that refuses to be framed, so its \
page is a guest's main frame and not a subframe"
  ;;
"webview 1")
  FAILURE="the <webview> showed nothing. The page was drawn -- the witness \
color is on it -- so this is the guest: either the element never asked for \
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
  last_words "$LAST_ENGINE_LOG" >&2
fi
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
