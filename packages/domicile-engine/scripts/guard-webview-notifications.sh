#!/usr/bin/env bash
# Checks that a page in a browser window must ask before it notifies, even in a
# profile that stores an allow-all default (patch 0104). See
# packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-notifications.sh /build/chromium/src
#
# A profile may store an allow-all default, which lets any site notify from the
# background. Patch 0104 resets it to ask at startup, and the shell answers the
# prompt (patch 0103).
#
# Runs headless with software compositing. Delivery to
# org.freedesktop.Notifications is the compositor's and is tested there.
#
# Each run seeds the profile's default for the permission the page asks about
# to allow. Passes when the page's color appears: the page paints it only if
# navigator.permissions reports the permission as "prompt".
#
# NEGATIVE=1 is the control, two runs:
#
#   1. The page paints the color without asking. It must show, so the probe can
#      see a guest's color.
#   2. The page asks about geolocation, seeded the same way. It must not show,
#      so the engine reads the seeded default and the positive run reflects the
#      reset, not a seed that was ignored.
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

# The asking page's color and the shell's background. Both are distinct from
# other guards' colors and from browser backgrounds.
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

# Runs one engine and returns the probe's status. Each run gets a fresh
# profile, so no setting carries over between runs.
measure() { # $1 which run, $2 the permission the page asks about
  local which="$1" permission="$2"
  local engine_log="/tmp/domicile-webview-notifications-$which-engine.log"
  local probe_log="/tmp/domicile-webview-notifications-$which-probe.log"
  # Not escaped in the shell's query. Safe because it contains no `&`.
  local page="$PAGES/asks?permission=$permission"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE/Default"
  # The allow-all default a profile may hold. `none` asks about nothing, so it
  # seeds nothing.
  if [ "$permission" != "none" ]; then
    printf '{"profile":{"default_content_setting_values":{"%s":1}}}\n' \
      "$permission" >"$PROFILE/Default/Preferences"
  fi

  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="domicile://shell/?witness=$WITNESS&src=$page" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-notifications.js" \
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

# 2. The runs. The control's first leg must run first: it shows the probe can
#    see the color, so the second leg's absence is a real result.
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

# The verdict. `scripts/test-webview-notifications-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"notifications 0")
  PASSED="a page in a browser window reads notifications as \"prompt\" in a \
profile that stored allow, so a site asks the shell before it notifies"
  ;;
"notifications 1")
  FAILURE="the shell drew but the page's color did not: notifications are not \
\"prompt\" -- the profile's stored allow survived startup (patch 0104) -- or \
the guest never loaded; the server's log says which"
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
asking about a geolocation seeded to allow did not, so the engine reads the \
seed and the claim's color is the reset patch 0104 makes"
  ;;
"control 0 0")
  FAILURE="a page asking about geolocation read \"prompt\" though the profile \
was seeded to allow it, so the seeded profile was not read and the claim's \
color says nothing about the reset"
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
