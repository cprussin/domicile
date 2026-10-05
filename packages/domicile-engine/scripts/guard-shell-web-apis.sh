#!/usr/bin/env bash
# The shell's own page, asking what a widget on its bar needs: whether it may
# show a notification, and whether it may read an answer from another origin.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-web-apis.sh /build/chromium/src
#
# WHY THIS EXISTS. A shell is the place a user's own bar items live -- a mail
# counter on manganese's bar reads a web API and notifies when mail arrives --
# and both are the shell's origin, `domicile://shell`, asking for itself rather
# than a page in a <webview>. Patch 0068 allows notifications for the profile
# and patch 0066 classes the shell loopback; this asserts that what the shell
# page reads of both is "yes", and that a cross-origin answer reaches it.
#
# Headless and software-composited, like guard-webview-notifications.sh. Where
# a notification GOES is the compositor's, tested there.
#
# WHAT IT ASSERTS. That the shell's box is painted: it paints it only when
# notifications read as granted AND a fetch of another origin that allows it
# (`/cors`) hands back the answer.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control, two runs of the same shell:
#
#   1. the box painted without asking. It MUST show: this is the run that says
#      the harness can see the box at all.
#   2. the fetch of an origin that does not allow it (`/no-cors`). It MUST show
#      nothing: the browser refuses the shell an answer the other origin did
#      not share, so the claim's color is CORS answering, and not a fetch that
#      reads whatever it is pointed at.
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
  annotate "guard-shell-web-apis: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The box's color, and the shell's around it. Neither is any other
# guard's, and neither is a browser background.
COLOR="${COLOR:-2E6F95}"
WITNESS="${WITNESS:-5C3A21}"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shell-web-apis-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-web-apis-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
SERVER_LOG="${SERVER_LOG:-/tmp/domicile-shell-web-apis-server.log}"

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
  annotate "guard-shell-web-apis: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-shell-web-apis: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-web-apis: no python3, and the origin the shell reads is served by one"
  exit 77
}

# One browser, one shell, one answer: the probe's status. Every run gets the
# same switches and a fresh profile, so the runs differ in what the shell reads
# and nothing else -- a profile left over would be a setting left over.
measure() { # $1 which run, $2 what it reads, $3 1 to paint unasked
  local which="$1" api="$2" unasked="$3"
  local engine_log="/tmp/domicile-shell-web-apis-$which-engine.log"
  local probe_log="/tmp/domicile-shell-web-apis-$which-probe.log"
  local query="witness=$WITNESS&color=$COLOR&api=$PAGES/$api&unasked=$unasked"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="domicile://shell/?$query" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-shell-web-apis.js" \
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
    annotate_from "guard-shell-web-apis: the engine never opened its broker socket at $BROKER for the $which run" "$engine_log"
    echo "the engine said:" >&2
    tail -20 "$engine_log" >&2
    exit 1
  }
  echo "the engine is listening on $BROKER, its shell reading $PAGES/$api"

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
python3 "$SCRIPTS/guard-shell-web-apis-server.py" \
  --port 0 >"$SERVER_LOG" 2>&1 &
STARTED+=($!)
for _ in $(seq 1 60); do
  grep -q "serving" "$SERVER_LOG" 2>/dev/null && break
  sleep 0.25
done
PORT="$(served_port "$SERVER_LOG")" || {
  annotate_from "guard-shell-web-apis: the page server never said which port it took" "$SERVER_LOG"
  tail -20 "$SERVER_LOG" >&2
  exit 1
}
PAGES="http://127.0.0.1:$PORT"
echo "the other origin at $PAGES"

# 2. The runs. The control's order is the experiment: the second leg's absence
#    is a reading only because the first leg's presence came first.
if [ "$NEGATIVE" = "1" ]; then
  LEG_STARTED="$(date +%s)"
  measure unasked cors 1
  UNASKED_STATUS=$?
  if [ "$UNASKED_STATUS" -eq 0 ]; then
    budget_note shell-web-apis "$(($(date +%s) - LEG_STARTED))"
  fi

  FOR_SECONDS="$(budget_for shell-web-apis "$FOR_SECONDS")" \
    measure no-cors no-cors 0
  NO_CORS_STATUS=$?
  MEASURED="control $UNASKED_STATUS $NO_CORS_STATUS"
else
  measure granted cors 0
  MEASURED="granted $?"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME. Run directly by
# `scripts/test-shell-web-apis-guard.sh`.
FAILURE=""
PASSED=""
case "$MEASURED" in
"granted 0")
  PASSED="the shell's own page reads notifications as granted and reads an \
answer another origin shares, so a bar item can notify and call a web API"
  ;;
"granted 1")
  FAILURE="the shell drew but its box did not: notifications are not granted \
to the shell's origin (patch 0068), or the fetch of /cors was refused -- the \
engine log's GUARD line says which, and the server's log whether it was asked"
  ;;
"granted 2")
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no shell at all. This is the harness, not the shell"
  ;;
"granted "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 0 1")
  PASSED="the control is sharp: a box painted unasked showed, and one waiting \
on an origin that shares nothing did not, so the claim's color is CORS \
answering the shell"
  ;;
"control 0 0")
  FAILURE="the shell read an answer the other origin did not share, so a fetch \
reads whatever it is pointed at and the claim's color says nothing about CORS"
  ;;
"control 0 2")
  FAILURE="the no-cors leg measured nothing: its own shell never drew, so the \
box being absent is not a reading. This is the harness"
  ;;
"control 0 "*)
  FAILURE="the probe did not run for the control's no-cors leg ($MEASURED), \
so nothing was measured against the first leg"
  ;;
"control 1 "*)
  FAILURE="the control's first leg showed nothing: a box painted without \
asking was not seen, so this harness cannot see the box and an absent one \
proves nothing"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the control's own shell never appeared. \
This is the harness, not the shell"
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

annotate "guard-shell-web-apis: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  last_words "$LAST_ENGINE_LOG" >&2
fi
echo "what the other origin was asked for:" >&2
tail -20 "$SERVER_LOG" >&2
exit 1
