#!/usr/bin/env bash
# A page in a browser window that may show notifications, and nothing asking
# whether it may.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-notifications.sh /build/chromium/src
#
# WHY THIS EXISTS. Chrome asks before a site may notify, and the asking is a
# permission bubble drawn over the page -- on a desktop, over the shell, with
# no browser window for it to belong to. Left at "ask", every site's
# Notification.requestPermission() went unanswered and its notifications were
# lost. Patch 0068 sets the profile's default to allow; this asserts a page in
# a <webview> reads it.
#
# Headless and software-composited, like guard-webview-framing.sh. Where a
# notification GOES -- org.freedesktop.Notifications, which the compositor
# serves -- is not this guard's: there is no bus here, and the server is the
# compositor's, tested there.
#
# WHAT IT ASSERTS. That the page's flat color is on the shell's page: it paints
# it only when navigator.permissions says notifications are "granted".
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control, two runs of the same shell:
#
#   1. the page painting the color without asking. It MUST show: this is the
#      run that says the harness can see a guest's color at all.
#   2. the page asking about geolocation, which nothing granted. It MUST show
#      nothing: a permission the desk left alone reads as not granted, so the
#      claim's color is the default this patch set, and not a page that paints
#      whatever it is told.
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
  annotate "guard-webview-notifications: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The granted page's color, and the shell's around it. Neither is any other
# guard's, and neither is a browser background.
COLOR="${COLOR:-6B3FA0}"
WITNESS="${WITNESS:-3A5A40}"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-notifications-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-notifications-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
SERVER_LOG="${SERVER_LOG:-/tmp/domicile-webview-notifications-server.log}"

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
  annotate "guard-webview-notifications: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-webview-notifications: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-notifications: no python3, and the page this asks with is served by one"
  exit 77
}

# One browser, one shell, one answer: the probe's status. Every run gets the
# same switches and a fresh profile, so the runs differ in the page's question
# and nothing else -- a profile left over would be a setting left over.
measure() { # $1 which run, $2 the permission the page asks about
  local which="$1" permission="$2"
  local engine_log="/tmp/domicile-webview-notifications-$which-engine.log"
  local probe_log="/tmp/domicile-webview-notifications-$which-probe.log"
  # Unescaped inside the shell's own query, which is safe because it carries
  # no `&`: URLSearchParams reads everything after `src=` as the address.
  local page="$PAGES/asks?permission=$permission"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="domicile://shell/?witness=$WITNESS&src=$page" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-notifications.js" \
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
    annotate_from "guard-webview-notifications: the engine never opened its broker socket at $BROKER for the $which run" "$engine_log"
    echo "the engine said:" >&2
    tail -20 "$engine_log" >&2
    exit 1
  }
  echo "the engine is listening on $BROKER, showing $page in a browser window"

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

# 1. The server.
rm -f "$SERVER_LOG"
python3 "$SCRIPTS/guard-webview-notifications-server.py" \
  --port 0 --color "$COLOR" >"$SERVER_LOG" 2>&1 &
STARTED+=($!)
for _ in $(seq 1 60); do
  grep -q "serving" "$SERVER_LOG" 2>/dev/null && break
  sleep 0.25
done
PORT="$(served_port "$SERVER_LOG")" || {
  annotate_from "guard-webview-notifications: the page server never said which port it took" "$SERVER_LOG"
  tail -20 "$SERVER_LOG" >&2
  exit 1
}
PAGES="http://127.0.0.1:$PORT"
echo "the page at $PAGES"

# 2. The runs. The control's order is the experiment: the second leg's absence
#    is a reading only because the first leg's presence came first.
if [ "$NEGATIVE" = "1" ]; then
  LEG_STARTED="$(date +%s)"
  measure unasked none
  UNASKED_STATUS=$?
  if [ "$UNASKED_STATUS" -eq 0 ]; then
    budget_note webview-notifications "$(($(date +%s) - LEG_STARTED))"
  fi

  FOR_SECONDS="$(budget_for webview-notifications "$FOR_SECONDS")" \
    measure geolocation geolocation
  GEOLOCATION_STATUS=$?
  MEASURED="control $UNASKED_STATUS $GEOLOCATION_STATUS"
else
  measure notifications notifications
  MEASURED="notifications $?"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME. Run directly by
# `scripts/test-webview-notifications-guard.sh`.
FAILURE=""
PASSED=""
case "$MEASURED" in
"notifications 0")
  PASSED="a page in a browser window reads notifications as granted, so no \
prompt stands between a site and the desktop's notifications"
  ;;
"notifications 1")
  FAILURE="the shell drew but the page's color did not: notifications are not \
granted -- the profile's default is not allow (patch 0068) -- or the guest \
never loaded; the server's log says which"
  ;;
"notifications 2")
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the permission"
  ;;
"notifications "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 0 1")
  PASSED="the control is sharp: a page that paints unasked showed, and one \
asking about a permission nothing granted did not, so the claim's color is \
the default patch 0068 sets"
  ;;
"control 0 0")
  FAILURE="a page asking about geolocation was told it was granted, so this \
profile grants what it is asked and the claim's color says nothing about \
notifications"
  ;;
"control 0 2")
  FAILURE="the geolocation leg measured nothing: its own shell never drew, so \
the color being absent is not a reading. This is the harness"
  ;;
"control 0 "*)
  FAILURE="the probe did not run for the control's geolocation leg \
($MEASURED), so nothing was measured against the first leg"
  ;;
"control 1 "*)
  FAILURE="the control's first leg showed nothing: a guest that paints \
without asking was not seen, so this harness cannot see a guest's color and \
an absent one proves nothing"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the control's own shell never appeared. \
This is the harness, not the permission"
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

annotate "guard-webview-notifications: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  last_words "$LAST_ENGINE_LOG" >&2
fi
echo "what the page server was asked for:" >&2
tail -20 "$SERVER_LOG" >&2
exit 1
