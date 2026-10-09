#!/usr/bin/env bash
# Guard: `find()` and `stopFinding()` on a <webview> search the guest page,
# and the element reports the match count.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-find.sh /build/chromium/src
#
# Runs headless with software compositing; nothing here is measured in pixels.
#
# The element's renderer cannot see the guest's frames. The element sends find
# over the WebViewGuest pipe, the guest's FindRequestManager searches every
# frame, and the count returns as FindChanged. `BrowserWindow.test.tsx` only
# checks that the find bar calls `find()`; jsdom has no nested page to search.
#
# The page holds the word three times: twice in its text and once in a
# cross-site (out-of-process) frame. Readings after each step, as
# matches/active:
#
#   found      3/1   every frame counted, first selected (the claim)
#   next       3/2   the same text again moves to the next match
#   previous   3/1   backward moves to the previous match
#   stopped    0/0   stopFinding() ended it
#   refound    3/…   find again so `navigated` has a find to end; which match
#                    is active is up to Blink
#   navigated  0/0   navigating ends a find
#
# NEGATIVE=1 runs the same pages and calls nothing (an <iframe> is no control:
# it has no find()). It must read 0/0 throughout, see no find events, and still
# reach the second page, so `navigated` in the positive run is meaningful.
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
  annotate "guard-webview-find: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the control; see the header.
NEGATIVE="${NEGATIVE:-0}"
DRIVE="find"
[ "$NEGATIVE" = "1" ] && DRIVE="none"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-find-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-find-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# A word no page contains by accident, long enough that content searches it
# without the short-query delay. Twice on /words, once in its frame.
WORD="quokkaish"
MATCHES=3

# Timeouts. Steps advance as soon as they are satisfied.
#
#   SETTLE   the first page: attach, navigate and load its frame
#   STEP     each later step
#   QUIET    how long the control watches each step, since an absence has no
#            event. Longer than a healthy step
SETTLE_MS="${SETTLE_MS:-25000}"
STEP_MS="${STEP_MS:-8000}"
QUIET_MS="${QUIET_MS:-3000}"

# At least SETTLE + six STEPs plus engine startup. Generous because the build
# machine is shared.
FOR_SECONDS="${FOR_SECONDS:-180}"

# Separate logs for the control run.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-find$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-find$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-find: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-find: no python3, and the pages a find searches are served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits up to `$1` quarter seconds for `$2` to appear in `$3`.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. Serve the pages locally; `crux` cannot reach external hosts.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-find-server.py" \
  --port 0 --word "$WORD" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-find: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-find: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
# 127.0.0.1, because the frame is served as `localhost`: a different site, so
# out of process.
SUBJECT="http://127.0.0.1:$PORT"
echo "serving a browser window's pages under $SUBJECT"

# 2. Start the engine on a domicile:// page, the only origin WebViewGuestHost
#    is bound for. `--app` matches how `domicile` runs it.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?drive=$DRIVE&src=$SUBJECT&word=$WORD&matches=$MATCHES&settle=$SETTLE_MS&step=$STEP_MS&quiet=$QUIET_MS" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-find.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD driving" "$ENGINE_LOG" || {
  annotate_from "guard-webview-find: the shell module never ran, so nothing was ever driven" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell is driving mode=$DRIVE"

# 3. Wait for the module to finish its schedule.
wait_for_line "$TRIES" "GUARD done" "$ENGINE_LOG" ||
  echo "the schedule never finished; what follows is a run cut short" >&2

# The element's matches/active at each point. `head -1`: if a point is logged
# twice, the first decides.
STATES="$(grep -o 'GUARD find-state at=[^ ]* find=[^ ]* events=[0-9]*' \
  "$ENGINE_LOG")"
find_at() { # $1 point
  printf '%s\n' "$STATES" |
    sed -n "s/^GUARD find-state at=$1 find=\([^ ]*\) .*\$/\1/p" | head -1
}
events_at() { # $1 point
  printf '%s\n' "$STATES" |
    sed -n "s/^GUARD find-state at=$1 .* events=\([0-9]*\)\$/\1/p" | head -1
}
FOUND="$(find_at found)"
FOUND_EVENTS="$(events_at found)"
NEXT="$(find_at next)"
PREVIOUS="$(find_at previous)"
STOPPED="$(find_at stopped)"
REFOUND="$(find_at refound)"
NAVIGATED="$(find_at navigated)"
NAVIGATED_EVENTS="$(events_at navigated)"

SAW_MODULE=$(grep -qF "GUARD driving" "$ENGINE_LOG" && echo 1 || echo 0)
SAW_WORDS=$(grep -qF "GUARD guest-shown path=/words" "$ENGINE_LOG" && echo 1 || echo 0)
SAW_ELSEWHERE=$(grep -qF "GUARD guest-shown path=/elsewhere" "$ENGINE_LOG" && echo 1 || echo 0)
# Whether the frame was requested. Tells "the count missed the frame" from
# "there was no frame".
SAW_FRAMED_ASKED=$(grep -qF "GET /framed " "$HTTP_LOG" && echo 1 || echo 0)

echo
echo "module=$SAW_MODULE words=$SAW_WORDS framed-asked=$SAW_FRAMED_ASKED elsewhere=$SAW_ELSEWHERE"
echo "the element said: found=$FOUND next=$NEXT previous=$PREVIOUS stopped=$STOPPED refound=$REFOUND navigated=$NAVIGATED"
echo "find events: at found=$FOUND_EVENTS at navigated=$NAVIGATED_EVENTS"
echo

# Turn the readings into a verdict. `scripts/test-webview-find-guard.sh` tests
# this block. Checks run in dependency order.
FAILURE=""
PASSED=""
if [ "$SAW_MODULE" != "1" ]; then
  FAILURE="the shell module never ran, so nothing here was ever driven. This \
is the harness: the page did not load, or its query was wrong, and the engine \
log has its console"
elif [ "$SAW_WORDS" != "1" ]; then
  FAILURE="the window never showed the page to search, so there is no guest \
here to find anything in. That is the guest and not the find: it was not \
made, not attached, or not navigated. The http log says whether the page was \
ever asked for"
elif [ "$SAW_FRAMED_ASKED" != "1" ]; then
  FAILURE="the page's cross-site frame was never asked for, so one of the \
three matches is not in the page and a count of two would be right. This is \
the fixture or the guest's frame loading, not the find"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$FOUND/$NEXT/$PREVIOUS/$STOPPED/$REFOUND/$NAVIGATED" != \
    "0/0/0/0/0/0/0/0/0/0/0/0" ]; then
    FAILURE="the element reported a find with nothing calling one: \
found=$FOUND next=$NEXT previous=$PREVIOUS stopped=$STOPPED refound=$REFOUND \
navigated=$NAVIGATED where every one is 0/0. Something here counts unasked, so \
the positive run's counts need not be the find's and this pair decides nothing"
  elif [ "$NAVIGATED_EVENTS" != "0" ]; then
    FAILURE="the element announced $NAVIGATED_EVENTS find change(s) with \
nothing driving it. The positive run reads its events as the find's, so a run \
that announces unasked makes them noise — a page change reported as a find \
change that is not one"
  elif [ "$SAW_ELSEWHERE" != "1" ]; then
    FAILURE="the second page never arrived even with nothing in its way. The \
positive run reads a new page ending a find there, so without it that reading \
is taken on a page that never changed. This is the harness or the guest's \
navigation"
  else
    PASSED="the control is sharp: the same element, the same guest and the \
same pages with no find called read 0/0 at every point and announce nothing, \
so the positive run's counts are the find's — and the second page arrives, so \
its reading there is about a new page"
  fi
elif [ "$FOUND" = "0/0" ] || [ -z "$FOUND" ]; then
  FAILURE="find() found nothing: the element said \"$FOUND\" for a page that \
holds the word $MATCHES times. THIS IS THE CLAIM: the call has to reach the \
guest's WebContents over the WebViewGuest pipe, and the count has to come back \
as FindChanged. One of the two did not"
elif [ "$FOUND" = "$((MATCHES - 1))/1" ]; then
  FAILURE="find() counted $FOUND where the page holds $MATCHES: the two in \
its own text and not the one in its cross-site frame. That frame is out of \
process, so its matches come from FindRequestManager adding up every frame in \
the guest — and a count of the main frame alone is a find run somewhere that \
cannot see the rest"
elif [ "$FOUND" != "$MATCHES/1" ]; then
  FAILURE="find() left the element saying \"$FOUND\" where the page holds \
$MATCHES and the first is selected. The find reached the guest — it found \
something — so this is the count or the ordinal coming back wrong"
elif [ "$FOUND_EVENTS" = "0" ] || [ -z "$FOUND_EVENTS" ]; then
  FAILURE="the element never announced a find change, so a find bar has \
nothing to re-read on. The values themselves are right, which makes this the \
half a shell cannot do without: a count that never moves past its first render"
elif [ "$NEXT" != "$MATCHES/2" ]; then
  FAILURE="the same text again left the element saying \"$NEXT\" where the \
second match is selected. Finding the same text is \"find next\" — Chrome's \
find bar's rule, kept in WebViewGuest::Find — and a guest that starts a new \
search every time stays on the first match"
elif [ "$PREVIOUS" != "$MATCHES/1" ]; then
  FAILURE="find(text, true) left the element saying \"$PREVIOUS\" where the \
first match is selected again. A find next goes to the focused frame, and \
the focus is in the shell, not the guest: without patch 0073 it falls back \
to the first frame in the direction asked, so backward starts over from the \
last frame instead of the active match. Or the element's argument arrived \
the wrong way round"
elif [ "$STOPPED" != "0/0" ]; then
  FAILURE="stopFinding() left the element saying \"$STOPPED\" where there is \
no find. So a find bar closed keeps a count of matches that are no longer \
highlighted: WebViewGuest::StopFinding not reporting, or the element not \
storing it"
elif [ "${REFOUND%/*}" != "$MATCHES" ] || [ "${REFOUND#*/}" = "0" ]; then
  FAILURE="a find after stopFinding() left the element saying \"$REFOUND\" \
where it counts $MATCHES with one selected. A stopped find has to leave the \
next one a new search, and this is the text it was on not having been \
forgotten. Without it there is no find for the next page to end, so the \
reading after it is not a measurement"
elif [ "$SAW_ELSEWHERE" != "1" ]; then
  FAILURE="the second page never arrived, so the find was never on a page \
that changed and the reading after it measures nothing. This is the harness or \
the guest's navigation, not the find"
elif [ "$NAVIGATED" != "0/0" ]; then
  FAILURE="the guest went to a new page and the element went on saying \
\"$NAVIGATED\". A NEW PAGE ENDS A FIND, which is Chrome's rule: the matches \
counted were the old page's. This is WebViewGuest::PrimaryPageChanged not \
ending it, or its report not arriving"
else
  PASSED="a <webview>'s find runs on the guest: it counted every match in the \
page, the cross-site frame's included, stepped forward and back through them, \
ended on stopFinding(), and ended again when the guest went to a new page — \
with an event for a find bar to re-read on"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-find: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
