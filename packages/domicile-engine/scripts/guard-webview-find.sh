#!/usr/bin/env bash
# What a browser window's find bar can drive and can know: `find()` and
# `stopFinding()` on a <webview>, run on the guest behind it, and the count the
# element holds of what they found.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-find.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as
# guard-webview-history.sh runs: nothing here is measured in pixels, so
# `--ozone-platform=headless` with software compositing is the whole of the
# environment.
#
# WHY THIS EXISTS. A <webview>'s page is a guest — an inner WebContents in the
# browser process — and the renderer the element lives in can see none of its
# frames. So a find is the browser's: the element sends it down the
# WebViewGuest pipe, the guest's own FindRequestManager searches every frame in
# the guest, and the count comes back as FindChanged. Every link of that is
# what this asserts.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM. There is no nested browsing context in
# jsdom, so there is no page to search; `BrowserWindow.test.tsx` asserts that
# the find bar calls `find()` on the element and would keep passing with this
# whole path removed. The claim is "the window's page holds three of these and
# the second is selected", and only a real engine can be asked it.
#
# THE POSITIVE IS ESTABLISHED FIRST. A guard that measured only "a new page
# ends a find" would pass against an element that never found anything. So the
# page holds the word three times — twice in its own text and once in a
# CROSS-SITE frame, which is out of process and so is the part of the count the
# element's own renderer could never have made — and what is asserted is the
# element's reading after each step, as matches/active:
#
#   found      3/1   THE CLAIM: every frame counted, and the first selected
#   next       3/2   the same text again is the next match, not a new search
#   previous   3/1   and backward is the one before
#   stopped    0/0   stopFinding() ended it
#   refound    3/…   a find again, for the navigation below to end. Which match
#                    a search begun from a kept selection lands on is Blink's
#                    business, so only that one is selected is asserted
#   navigated  0/0   a new page ends a find, with nothing called
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the same shell, the same element, the same
# guest and the same two pages, and CALLS NOTHING. Not an <iframe> in the
# element's place: an <iframe> has no find() at all, so that run would end on
# a TypeError rather than on a reading. What it decides:
#
#   every reading must stay 0/0   or the element reports a count nobody asked
#                                  for, and the positive run's need not be the
#                                  find's
#   no event may arrive           or something announces a find with nothing
#                                  driving it, and the positive run's events
#                                  are noise
#   the second page must arrive   or the positive run's `navigated` is read on
#                                  a page that never changed, and says nothing
#                                  about a new page ending a find
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-find: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 calls no find. See the header.
NEGATIVE="${NEGATIVE:-0}"
DRIVE="find"
[ "$NEGATIVE" = "1" ] && DRIVE="none"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-find-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-find-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# What the pages hold, and how many: twice on /words and once in its frame. One
# word no page says by accident, and long enough that content searches for it
# without the delay it gives a find typed a letter at a time.
WORD="quokkaish"
MATCHES=3

# THE NUMBERS THE EXPERIMENT IS MADE OF. Each step advances as soon as what it
# waits for has happened; SETTLE and STEP only bound a step that never does.
#
#   SETTLE   bounds the first page: the guest has to be asked for, attached and
#            navigated, and its frame loaded
#   STEP     bounds each step after it
#   QUIET    how long the control watches a step it does not drive, since an
#            absence has no event to wait for. Longer than a healthy step
SETTLE_MS="${SETTLE_MS:-25000}"
STEP_MS="${STEP_MS:-8000}"
QUIET_MS="${QUIET_MS:-3000}"

# Every bound sat out is SETTLE + six STEPs, and the engine has to start before
# any of it. Generous on top: this machine is shared.
FOR_SECONDS="${FOR_SECONDS:-180}"

# A run and its own control are two measurements, so they get two sets of logs.
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

# Waits for `$2` to appear in `$3`, for `$1` quarter seconds.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages. Their own server rather than real sites: `crux` reaches no
#    arbitrary host.
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
# 127.0.0.1, because the server frames its page as `localhost`: two sites, so
# the frame is out of process. See the server's docstring.
SUBJECT="http://127.0.0.1:$PORT"
echo "serving a browser window's pages under $SUBJECT"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other. `--app` for the reason
#    `domicile` uses it: the guard runs the configuration the product runs.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?drive=$DRIVE&src=$SUBJECT&word=$WORD&matches=$MATCHES&settle=$SETTLE_MS&step=$STEP_MS&quiet=$QUIET_MS" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-find.js" \
  --no-sandbox --password-store=basic --no-first-run \
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

# 3. The whole schedule, which the module owns. Waiting on its last line rather
#    than sleeping for the arithmetic.
wait_for_line "$TRIES" "GUARD done" "$ENGINE_LOG" ||
  echo "the schedule never finished; what follows is a run cut short" >&2

# WHAT THE ELEMENT SAID THE FIND FOUND, at each point the module reads it, as
# matches/active. `head -1` because a point is read once, and a log that
# somehow holds two should be decided by the first.
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
# Asked for, out of the server's log: the frame's own page says nothing, so
# this is what tells "the count missed the frame" from "there was no frame".
SAW_FRAMED_ASKED=$(grep -qF "GET /framed " "$HTTP_LOG" && echo 1 || echo 0)

echo
echo "module=$SAW_MODULE words=$SAW_WORDS framed-asked=$SAW_FRAMED_ASKED elsewhere=$SAW_ELSEWHERE"
echo "the element said: found=$FOUND next=$NEXT previous=$PREVIOUS stopped=$STOPPED refound=$REFOUND navigated=$NAVIGATED"
echo "find events: at found=$FOUND_EVENTS at navigated=$NAVIGATED_EVENTS"
echo

# WHICH END TO BLAME, decided here in a block
# `scripts/test-webview-find-guard.sh` runs directly, rather than inferred from
# a grep by whoever opens the job. The order is the order the readings depend
# on each other in: a run with no page has nothing to count, and a find that
# never counted has nothing for a navigation to end.
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
the focus is in the shell, not the guest: without patch 0072 it falls back \
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
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
