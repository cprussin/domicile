#!/usr/bin/env bash
# Checks that a tray click grants an extension activeTab on the focused
# <webview>, by reading the color the extension then paints.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-active-tab.sh /build/chromium/src
#
# Chrome grants activeTab in ExtensionActionRunner, which the shell-drawn tray
# never reaches, so `ExtensionTray::Activate` grants it itself. Without that,
# the fixture's executeScript is refused.
#
# Setup, headless:
#
# - guard-extension-installer.sh's compositor stand-in names the fixture as
#   `unpacked`.
# - The fixture has only `activeTab` and `scripting`, and paints the tab
#   `COLOR` when its action is clicked.
# - The page is served `--still`, since a reload would wipe the paint. It moves
#   to `#ready` once loaded, because clicking before commit grants the wrong
#   page (cprussin/domicile#797).
# - The shell focuses the <webview> on `#ready`, then clicks the fixture
#   (`?activate=1`) once its badge shows.
#
# Asserts `COLOR` appears in the window, with the shell background as witness,
# and that the logs show the click and the grant.
#
# NEGATIVE=1 runs the same setup without the click. `COLOR` must not appear,
# and the witness is the served page's color, so the guest is known to have
# drawn.
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

# The fixture id and the color its onClicked paints. Fixed:
# `scripts/test-webview-active-tab-guard.sh` checks them against the
# manifest's `key` and `background.js`.
readonly ID="hbnfdakjdmmlmbpllmlphpingenajmci"
readonly COLOR="00897B"
# The shell's background and the served page's color, unique to this guard.
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
# One server per leg, as in guard-extension-tray.sh: the control runs right
# after the claim, and a shared server could write into the control's log.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-active-tab-http-$NEGATIVE.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    # Reap it so nothing outlives the leg or writes into the next leg's files.
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

# 1. Serve the page, still. Use a local server: `crux` cannot reach arbitrary
#    hosts.
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

# The claim clicks; the control does not, and uses the page as witness.
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

# 2. The compositor stand-in names the fixture in both legs; the only
#    difference is the click.
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
  --no-sandbox --password-store=basic --no-first-run \
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

# 4. The probe watches until it sees `COLOR` or gives up.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

# Record timing only on a pass; a failed run measured only the timeout.
if [ "$NEGATIVE" != "1" ] && [ "$STATUS" -eq 0 ]; then
  budget_note webview-active-tab "$(($(date +%s) - STARTED_AT))"
fi

# The readings, each anchored on the quote Chromium puts after a console
# message. See guard-control-arrival.sh.
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

# The verdict. `scripts/test-webview-active-tab-guard.sh` runs this block
# directly. MEASURED is "<leg> <probe status> <sent> <tray> <activated>
# <granted>"; probe status is 0 for the color seen, 1 for the witness only, 2
# for neither.
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
