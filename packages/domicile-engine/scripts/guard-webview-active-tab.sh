#!/usr/bin/env bash
# A click in the shell's tray granting an extension activeTab on the focused
# <webview>, read as the color the extension then paints into it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-active-tab.sh /build/chromium/src
#
# WHY THIS EXISTS. In Chrome, clicking an extension's action grants it
# `activeTab` on the active tab: host access to that page until it navigates
# away, so `scripting.executeScript` works there. Chrome grants it in
# ExtensionActionRunner, which the tray never reaches -- the shell draws the
# icon -- so `ExtensionTray::Activate` grants it itself. Without that, the
# fixture's onClicked is dispatched and its executeScript is refused.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`. The fixture asks for `activeTab` and
# `scripting` and no host; a click on its action paints the tab it is handed
# `COLOR`. The shell shows one <webview> on its witness, focuses it once its
# page says it loaded, and once the fixture is in the tray wearing the badge its
# worker sets once it listens, `?activate=1` clicks it with activateExtension.
# The page is served `--still`: a reload would wipe the paint. And it says it
# loaded by moving to `#ready`, because a click on a page that has not
# committed grants the wrong page, and is refused (cprussin/domicile#797).
#
# WHAT IT ASSERTS. That `COLOR` is then in the window, with the shell's
# background as the witness -- and that the shell clicked and the tray
# granted, which the logs say.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same run, the fixture
# installed and in the tray, and no click. It MUST NOT show `COLOR`, and its
# witness is the served page's own color, so the absence is read off a guest
# that drew. That is what makes the claim's color the click's: nothing else in
# the run paints it.
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
  annotate "guard-webview-active-tab: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture, as the tray must name it, and the color its onClicked paints.
# Fixed rather than overridable: `scripts/test-webview-active-tab-guard.sh`
# holds the id to the manifest's `key` and the color to `background.js`.
readonly ID="hbnfdakjdmmlmbpllmlphpingenajmci"
readonly COLOR="00897B"
# The shell's background, and the served page's own color. No other guard's.
WITNESS="${WITNESS:-3A1C2E}"
PAGE_COLOR="${PAGE_COLOR:-FDD835}"

EXTENSION="$SCRIPTS/guard-webview-active-tab-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-active-tab-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-active-tab-control}"
PROFILE="${PROFILE:-/tmp/domicile-webview-active-tab-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-active-tab-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-webview-active-tab-socket.log}"
PROBE_LOG="${PROBE_LOG:-/tmp/domicile-webview-active-tab-probe.log}"
# One per leg, as guard-extension-tray.sh's: the control runs straight after
# the claim, and a server still answering the claim's engine as it died wrote
# into the control's log.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-active-tab-http-$NEGATIVE.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    # Reaped, so nothing this started outlives the leg -- and a server still
    # answering cannot write into the next leg's files.
    wait "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-active-tab: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-webview-active-tab: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-active-tab: no python3, and the page and the compositor's end of the socket are served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$BROKER" "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The page, still. Its own server: `crux` reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color "$PAGE_COLOR" --still >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-active-tab: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-active-tab: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# The claim clicks; the control does not, and its witness is the page's.
if [ "$NEGATIVE" = "1" ]; then
  ACTIVATE=0
  LEG=control
  WITNESSED="$PAGE_COLOR"
  FOR_SECONDS="$(budget_for webview-active-tab "$FOR_SECONDS")"
else
  ACTIVATE=1
  LEG=painted
  WITNESSED="$WITNESS"
fi

# 2. The compositor's end, naming the fixture in both legs: the control's
#    difference is the click and nothing else.
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --unpacked "$EXTENSION" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-webview-active-tab: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine.
STARTED_AT="$(date +%s)"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&activate=$ACTIVATE&witness=$WITNESS&src=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-active-tab.js" \
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
  annotate_from "guard-webview-active-tab: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER, showing $PAGE in a <webview>"

# 4. The reading: the probe watches until it sees `COLOR`, or gives up.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

# Only on a pass: a failed run measured this script's patience.
if [ "$NEGATIVE" != "1" ] && [ "$STATUS" -eq 0 ]; then
  budget_note webview-active-tab "$(($(date +%s) - STARTED_AT))"
fi

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-windows-state.sh for why.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
TRAY=$(saw "\"GUARD tray id=$ID\"")
ACTIVATED=$(saw "\"GUARD activated id=$ID\"")
GRANTED=$(saw "domicile: the tray granted $ID activeTab")

MEASURED="$LEG $STATUS $SENT $TRAY $ACTIVATED $GRANTED"
echo
echo "measured: $MEASURED"
echo "what the fixture was refused, if anything:"
grep -F 'GUARD refused' "$ENGINE_LOG" | tail -3 || true

# WHICH END TO BLAME. `scripts/test-webview-active-tab-guard.sh` runs this
# block directly. MEASURED is "<leg> <probe status> <sent> <tray> <activated>
# <granted>"; the probe's status is 0 for the color seen, 1 for the witness
# alone, 2 for neither.
FAILURE=""
PASSED=""
case "$MEASURED" in
"painted 0 1 1 1 1")
  PASSED="a click in the tray granted the extension activeTab on the focused \
<webview>, and its scripting.executeScript painted the page"
  ;;
"painted 0 "*)
  FAILURE="the color appeared, but not after a click the tray granted \
($MEASURED), so something other than the grant painted it. Check that the \
profile was fresh"
  ;;
"painted 1 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind and nothing \
was installed"
  ;;
"painted 1 1 0 "*)
  FAILURE="the fixture never reached the tray with its badge, so there was \
nothing to click: the installer, ExtensionTray, or its service worker never ran"
  ;;
"painted 1 1 1 0 "*)
  FAILURE="the shell never clicked: its window never showed its page at \
#ready, so it was never focused. The guest, or the page server"
  ;;
"painted 1 1 1 1 0")
  FAILURE="the shell clicked and the tray granted nothing: there was no \
active tab, so the element's focus never reached the browser \
(WebViewGuest::Focused), or this engine's ExtensionTray::Activate does not \
grant, or the fixture lost its activeTab permission"
  ;;
"painted 1 1 1 1 1")
  FAILURE="the tray granted activeTab and the page stayed unpainted: the \
fixture's onClicked was not dispatched, or its executeScript was refused -- \
the GUARD refused line above says which"
  ;;
"painted 2 "*)
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the grant"
  ;;
"painted "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 1 1 1 0 0")
  PASSED="the control is sharp: the same extension, installed and unclicked, \
left the same page unpainted -- so the claim's color is the click's"
  ;;
"control 0 "*)
  FAILURE="the page was painted with no click, so something other than the \
grant paints it and the claim proves nothing"
  ;;
"control 1 0 "* | "control 1 1 0 "*)
  FAILURE="the page drew unpainted, but the fixture was never installed, so \
the absence answers nothing: the list, the installer, or ExtensionTray"
  ;;
"control 1 1 1 "*)
  FAILURE="the control clicked, or the tray granted without a click \
($MEASURED): the shell module ignored ?activate=0, or something else activated \
the fixture"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the page in the <webview> never drew, so its \
missing color is not a reading. The guest, or the harness"
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

annotate_from "guard-webview-active-tab: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
