#!/usr/bin/env bash
# An extension the config allows in private windows, running in a private page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-in-private.sh /build/chromium/src
#
# WHY THIS EXISTS. Chrome keeps an extension out of private pages until its
# user allows it on chrome://extensions, which a desk has none of: the config's
# `extensions.settings` says `"private": true` instead, and the engine sets it
# once the extension installs (domicile_extension_settings.h). A private page
# is a <webview private>, a guest of the off-the-record profile, so what the
# desk asked for is that the extension RUNS there. That is what this reads: the
# fixture's content-script mark, in a <webview private>.
#
# guard-extension-installer.sh with a private page: its stand-in, its shell and
# its probe, and a fixture of its own whose `key` fixes the id the settings
# name.
#
# WHAT IT ASSERTS. That the stand-in sent the list naming the fixture as
# `unpacked`, allowed in private windows, and that `COLOR` is then somewhere in
# the window, with the shell's background as the witness.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same list with no settings.
# The extension installs as before and MUST NOT mark the private page, whose
# own color is the witness -- so the claim's mark is the setting's, not
# something that marks every private page.
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
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-in-private: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The mark and the fixture's id. Fixed rather than overridable: the fixture's
# `content.js` paints the one and its `key` makes the other, and
# `packages/domicile-engine/tests/test-extension-in-private-guard.sh` holds
# them together.
readonly COLOR="D81B60"
readonly ID="igpplbogafmhhghakahppneohdhbnamo"
# The shell's background, and the served page's own color: not the installer
# guard's, so the two can share a machine without reading each other.
WITNESS="${WITNESS:-3A1C2E}"
PAGE_COLOR="${PAGE_COLOR:-F9A825}"

EXTENSION="$SCRIPTS/guard-extension-in-private-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-extension-in-private-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-in-private-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-in-private-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-in-private-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-in-private-socket.log}"
PROBE_LOG="${PROBE_LOG:-/tmp/domicile-extension-in-private-probe.log}"
# One per leg. The control runs straight after the claim, and a claim's server
# still answering its engine's reloads as it dies wrote into the control's log,
# which then never said which port the control's own server took.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-extension-in-private-http-$NEGATIVE.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-extension-in-private: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-extension-in-private: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-in-private: no python3, and the page and the compositor's end of the socket are served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

fresh_broker
rm -f "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The page. Its own server: `crux` reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color "$PAGE_COLOR" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "serving" "$HTTP_LOG" || {
  annotate_from "guard-extension-in-private: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-extension-in-private: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# 2. The compositor's end, naming the fixture allowed in private windows --
#    or, for the control, naming it with no settings.
if [ "$NEGATIVE" = "1" ]; then
  SETTINGS="{}"
  WITNESSED="$PAGE_COLOR"
  FOR_SECONDS="$(budget_for extension-in-private "$FOR_SECONDS")"
else
  SETTINGS="{\"$ID\": {\"private\": true}}"
  WITNESSED="$WITNESS"
fi
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --unpacked "$EXTENSION" --settings "$SETTINGS" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-in-private: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine. No `--load-extension` and no `--disable-features`: the only
#    way the fixture gets in is the list, and into a private page, its
#    settings.
STARTED_AT="$(date +%s)"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?witness=$WITNESS&private=1&src=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-installer.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do
  [ -S "$BROKER" ] && break
  sleep 0.5
done
[ -S "$BROKER" ] || {
  annotate_from "guard-extension-in-private: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER, showing $PAGE in a <webview private>"

# 4. The reading.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1

if [ "$NEGATIVE" = "1" ]; then
  MEASURED="control $STATUS $SENT"
else
  # Only on a pass: a failed run measured this script's patience.
  if [ "$STATUS" -eq 0 ]; then
    budget_note extension-in-private "$(($(date +%s) - STARTED_AT))"
  fi
  MEASURED="allowed $STATUS $SENT"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME. `packages/domicile-engine/tests/test-extension-in-private-guard.sh` runs
# this block directly. The last field is whether the stand-in sent the list.
FAILURE=""
PASSED=""
case "$MEASURED" in
"allowed 0 1")
  PASSED="an extension the config allowed in private windows ran in a \
<webview private>: its content script marked the private page"
  ;;
"allowed 0 0")
  FAILURE="the mark appeared but the list was never sent, so something other \
than the installer put the extension there. Check the engine's flags, and \
that the profile was fresh"
  ;;
"allowed 1 0")
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind. Nothing here \
reached the installer"
  ;;
"allowed 1 1")
  FAILURE="the list was sent and the <webview private> showed no mark. The \
shell drew, so the settings were not applied (the engine log has the \
'domicile:' lines from the settings), or the extension is not allowed into \
private pages after all, or a private guest gets no content scripts. If \
guard-extension-installer.sh passes, the extension installs"
  ;;
"allowed 2 "*)
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the settings"
  ;;
"allowed "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 1 1")
  PASSED="the control is sharp: the same extension with no settings left the \
same private page unmarked -- so the claim's mark is the setting's"
  ;;
"control 0 "*)
  FAILURE="the private page was marked with no settings, so extensions run in \
private pages unasked, or the profile was not fresh, and the claim proves \
nothing"
  ;;
"control 1 0")
  FAILURE="the page drew unmarked, but the list was never sent, so the absence \
answers nothing: the shell's control channel did not bind"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the page in the <webview private> never \
drew, so its missing mark is not a reading. The guest, or the harness"
  ;;
"control "*)
  FAILURE="the probe did not run for the control ($MEASURED), so it measured \
nothing"
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

annotate_from "guard-extension-in-private: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
