#!/usr/bin/env bash
# Checks that a <webview> lists the cameras and that preferring one puts it
# first, which is the camera a page that names none gets.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-media-devices.sh /build/chromium/src
#
# - Two fake cameras (`--use-fake-device-for-media-stream=device-count=2`).
# - The shell lists them, prefers the last, and lists them again. It also asks
#   for a kind that is not one, which must throw a TypeError.
# - Headless: listing and ranking devices draws nothing.
# - Control (`NEGATIVE=1`): prefer an id no camera has. It must be refused
#   with a NotFoundError and leave the order alone, or the positive run's
#   order proves nothing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-media-devices: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
PREFER="last"
[ "$NEGATIVE" = "1" ] && PREFER="no-such-camera"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-media-devices-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-media-devices-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-media-devices$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-media-devices$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-media-devices: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-media-devices: no python3, and the page in the window is served by one"
  exit 77
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-media-devices: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-media-devices: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The engine, showing the shell module as a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --use-fake-device-for-media-stream=device-count=2 \
  --app="domicile://shell/?src=$SUBJECT&prefer=$PREFER" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-media-devices.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran" >&2
for _ in $(seq 1 "$TRIES"); do
  grep -qE "GUARD (relisted|never-listed|threw)" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
# The ids after `GUARD <what> cameras=`, comma-separated, or nothing.
cameras() { # $1 what
  grep -o "GUARD $1 cameras=[^ \"]*" "$ENGINE_LOG" | head -1 | cut -d= -f2-
}

SAW_SHELL=$(saw "GUARD shell-loaded")
LISTED="$(cameras listed)"
FIRST="${LISTED%%,*}"
LAST="${LISTED##*,}"
SAW_BAD_KIND=$(saw "GUARD bad-kind name=TypeError")
SAW_PREFERRED=$(saw "GUARD preferred id=")
SAW_REFUSED=$(saw "GUARD refused id=$PREFER name=NotFoundError")
RELISTED="$(cameras relisted)"
RELISTED_FIRST="${RELISTED%%,*}"

echo
echo "shell=$SAW_SHELL listed=$LISTED bad kind refused=$SAW_BAD_KIND"
echo "prefer=$PREFER preferred=$SAW_PREFERRED refused=$SAW_REFUSED relisted=$RELISTED"
echo

# The verdict. `scripts/test-webview-media-devices-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the harness did not load the module, or \
it threw"
elif [ -z "$LISTED" ] || [ "$FIRST" = "$LAST" ]; then
  FAILURE="mediaDevices() never listed two cameras: the element has no \
mediaDevices, WebViewGuest.ListMediaDevices did not answer, or Chrome listed \
no fake devices. The engine log has the shell's last reason"
elif [ "$SAW_BAD_KIND" != "1" ]; then
  FAILURE="setMediaDevice(\"speaker\") did not throw a TypeError: \
HTMLWebViewElement::setMediaDevice took a kind that is not one"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_REFUSED" != "1" ]; then
    FAILURE="preferring a camera no device has was not refused with a \
NotFoundError, so the positive run's success says nothing"
  elif [ "$RELISTED_FIRST" != "$FIRST" ]; then
    FAILURE="a refused choice still changed the order: $LISTED became \
$RELISTED"
  else
    PASSED="a camera no device has is refused and the order stays"
  fi
elif [ "$SAW_PREFERRED" != "1" ]; then
  FAILURE="setMediaDevice rejected a camera mediaDevices() listed: \
PreferMediaDevice in domicile_media_devices.cc did not find it"
elif [ "$RELISTED_FIRST" != "$LAST" ]; then
  FAILURE="the preferred camera $LAST is not first afterwards ($RELISTED): \
the ranking was not stored, or mediaDevices() does not read it"
else
  PASSED="preferring the last camera puts it first, so a page that names \
none gets it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-media-devices: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
