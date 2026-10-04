#!/usr/bin/env bash
# An extension's action in the shell's tray, and its popup in a <webview>
# asking runtime.getContexts and tabs.getCurrent and closing itself.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-tray.sh /build/chromium/src
#
# WHY THIS EXISTS. EXTENSIONS.md's tray is two things the engine does and a
# page cannot fake: the browser telling the shell what an action says --
# `window.domicile`'s `extensions` event, from ExtensionTray -- and a popup in
# a <webview> saying it is done, which is `window.close()` becoming
# `domicile-close` on the element (WebViewGuest::CloseContents). And a popup
# asking runtime.getContexts, as Bitwarden's does on opening: that call switches
# on each of the extension's frames' view type, and a guest with none is a
# NOTREACHED that takes the whole browser down. Chrome gives its toolbar popup
# kExtensionPopup; AttachTabHelpers gives a <webview> marked `extensionpopup`
# the same, and no tab -- so tabs.getCurrent, which Bitwarden tells a popup
# from a tab by, answers nothing, as it does in Chrome.
#
# Headless, with guard-extension-installer.sh's stand-in for the compositor
# naming the fixture as `unpacked`: the fixture has a default title, a badge
# its service worker sets, and a popup that asks runtime.getContexts and
# tabs.getCurrent, writes the answers into its own address, and closes itself a second after that loads.
#
# WHAT IT ASSERTS. That the shell heard an `extensions` event carrying the
# fixture's id with its title, the service worker's badge and color, its popup
# URL, a PNG icon and `enabled`; that the <webview> the shell then points at
# that popup URL, marked `extensionpopup`, shows it; that getContexts lists the
# popup as a `POPUP` and tabs.getCurrent names no tab, as Chrome answers its
# toolbar popup; that the <webview> reports the
# popup's content size as the fixture lays it out, which is what a shell sizes
# its panel from (WebViewGuest::UpdatePreferredSize); and that the popup's
# `window.close()` reaches the shell as `domicile-close`.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the list empty, and the
# <webview> pointed at a served page that never calls `window.close()`. The
# shell must still hear an `extensions` event -- so the fixture's absence is an
# answer -- with no fixture in it, and the page must show, answer nothing, and
# NOT close, for as long as the claim took to close -- nor report the
# fixture's size.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-tray: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture, as the tray must report it. Fixed rather than overridable:
# `scripts/test-extension-tray-guard.sh` holds them to the fixture -- the id to
# the manifest's `key`, the badge and color to the service worker, the title
# to the manifest, the context to what Chrome calls an extension page in a tab.
readonly ID="cobncddhpfhclknjbapgflpohofecjhg"
readonly TITLE="Domicile tray guard"
readonly BADGE="7"
readonly BADGE_COLOR="#8e24aaff"
readonly POPUP="chrome-extension://$ID/popup.html"
readonly CONTEXT="POPUP"
readonly CURRENT_TAB="none"
readonly WIDTH="230"
readonly HEIGHT="170"
# What the width may read over WIDTH: Blink's max-content width for the page
# counts the gutter a classic vertical scrollbar takes, 15px on Linux, and 0
# where scrollbars overlay.
readonly SCROLLBAR="15"

EXTENSION="$SCRIPTS/guard-extension-tray-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-extension-tray-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-tray-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-tray-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-tray-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-tray-socket.log}"
# One per leg, as guard-extension-installer.sh's: the control runs straight
# after the claim, and a server still answering the claim's engine as it died
# wrote into the control's log.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-extension-tray-http-$NEGATIVE.log}"

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
  annotate "guard-extension-tray: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-tray: no python3, and the compositor's end of the socket and the control's page are served by one"
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

# 1. What the <webview> opens: the popup the tray names, or -- for the control
#    -- a served page that never closes itself.
if [ "$NEGATIVE" = "1" ]; then
  rm -f "$HTTP_LOG"
  python3 "$SCRIPTS/guard-webview-content-script-server.py" \
    --port 0 --color 25A8F9 >"$HTTP_LOG" 2>&1 &
  STARTED+=($!)
  wait_for_line 60 "serving" "$HTTP_LOG" || {
    annotate_from "guard-extension-tray: the control's page server never came up" "$HTTP_LOG"
    tail -20 "$HTTP_LOG" >&2
    exit 1
  }
  PORT="$(served_port "$HTTP_LOG")" || {
    annotate_from "guard-extension-tray: the control's page server never said which port it took" "$HTTP_LOG"
    exit 1
  }
  OPEN="http://127.0.0.1:$PORT/page"
  SHOWN="$OPEN"
  NAMED=()
else
  OPEN="popup"
  SHOWN="$POPUP"
  NAMED=(--unpacked "$EXTENSION")
fi

# 2. The compositor's end, naming the fixture -- or, for the control, nothing.
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" ${NAMED[@]+"${NAMED[@]}"} >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-tray: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine. No `--load-extension`: the fixture gets in by the list.
STARTED_AT="$(date +%s)"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?expect=$ID&open=$OPEN" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-tray.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" '"GUARD listening"' "$ENGINE_LOG" ||
  echo "the shell module never said it was listening; the verdict below says what that means" >&2

# 4. The wait. The claim ends on the close; the control ends once its page has
#    shown and then not closed for as long as the claim took to.
if [ "$NEGATIVE" = "1" ]; then
  wait_for_line "$TRIES" "\"GUARD page url=$SHOWN\"" "$ENGINE_LOG" &&
    wait_for_line "$(($(budget_for extension-tray "$FOR_SECONDS") * 4))" \
      '"GUARD closed' "$ENGINE_LOG"
else
  if wait_for_line "$TRIES" '"GUARD closed' "$ENGINE_LOG"; then
    budget_note extension-tray "$(($(date +%s) - STARTED_AT))"
  fi
fi

# A moment for anything already dispatched to be written out.
sleep 1

# THE READINGS, each anchored on the quote Chromium puts after a console
# message -- see guard-control-arrival.sh for the run that learned why.
saw() { # $1 fixed string
  grep -qF -- "$1" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}
# Whether a size the fixture lays out was reported: HEIGHT, and WIDTH up to
# SCROLLBAR over it -- for a page at $1, or any page with $1 empty.
sized() { # $1 address prefix, or empty
  grep -oE '"GUARD size width=[0-9]+ height=[0-9]+ url=[^"]*' "$ENGINE_LOG" 2>/dev/null |
    awk -v w="$WIDTH" -v h="$HEIGHT" -v s="$SCROLLBAR" -v u="$1" '
      { split($3, a, "="); split($4, b, "="); split($5, c, "=") }
      a[2] >= w && a[2] <= w + s && b[2] == h && index(c[2], u) == 1 { found = 1 }
      END { print found ? 1 : 0 }'
}

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1
HEARD=$(saw '"GUARD extensions count=')
if [ "$NEGATIVE" = "1" ]; then
  # Any row for the fixture at all: an empty list must leave none.
  TRAY=$(saw "\"GUARD tray id=$ID ")
  LEG=control
else
  TRAY=$(saw "\"GUARD tray id=$ID title=$TITLE badge=$BADGE color=$BADGE_COLOR popup=$POPUP icon=true enabled=true\"")
  LEG=tray
fi
OPENED=$(saw "\"GUARD page url=$SHOWN\"")
if [ "$NEGATIVE" = "1" ]; then
  # Any answer at all: a page that asked nothing must leave none.
  CONTEXTS=$(saw "?contexts=")
  CLOSED=$(saw "\"GUARD closed url=$SHOWN\"")
  SIZED=$(sized "")
else
  CONTEXTS=$(saw "\"GUARD page url=$SHOWN?contexts=$CONTEXT&tab=$CURRENT_TAB\"")
  # After any answer, so a wrong one still tells a crash from a close.
  CLOSED=$(saw "\"GUARD closed url=$SHOWN?contexts=")
  SIZED=$(sized "$SHOWN")
fi

MEASURED="$LEG $SENT $HEARD $TRAY $OPENED $CONTEXTS $CLOSED $SIZED"
echo
echo "measured: $MEASURED"
echo "what the shell heard of the tray:"
grep -F '"GUARD tray ' "$ENGINE_LOG" | tail -3 || true
echo "the sizes the <webview> reported:"
grep -F '"GUARD size ' "$ENGINE_LOG" | tail -3 || true

# WHICH END TO BLAME. `scripts/test-extension-tray-guard.sh` runs this block
# directly. MEASURED is "<leg> <sent> <heard> <tray> <opened> <contexts>
# <closed> <sized>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"tray 1 1 1 1 1 1 1")
  PASSED="the tray reported the fixture's action as its service worker left \
it, its popup showed in a <webview>, runtime.getContexts listed the popup as a \
POPUP and tabs.getCurrent named no tab, the <webview> reported the popup's content size, and the popup's \
window.close() reached the shell as domicile-close"
  ;;
"tray 0 "*)
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind and nothing \
was installed"
  ;;
"tray 1 0 "*)
  FAILURE="the shell heard no extensions event at all, so ExtensionTray did not \
bind -- the frame binder, or DomicileHost::EnsureBound -- or bound and never \
sent the list SetClient is owed"
  ;;
"tray 1 1 0 "*)
  FAILURE="the shell heard the tray, but never the fixture's row as the fixture \
leaves it -- id, title, the service worker's badge and color, the popup, a PNG \
icon, enabled. The GUARD tray lines above say what did arrive: none is the \
installer or ExtensionActionManager, a stale badge is ExtensionActionDispatcher's \
change not reaching the tray"
  ;;
"tray 1 1 1 0 "*)
  FAILURE="the tray named the popup and the <webview> never showed it, so a \
guest's navigation to chrome-extension:// was refused or never committed"
  ;;
"tray 1 1 1 1 0 0 "*)
  FAILURE="the popup showed and never answered runtime.getContexts: the call \
switches on each frame's view type and NOTREACHEDs on kInvalid, taking the \
browser down -- AttachTabHelpers did not give the guest kExtensionPopup, as \
Chrome gives its toolbar popup"
  ;;
"tray 1 1 1 1 0 1 "*)
  FAILURE="the popup answered without listing itself as a POPUP that is in no \
tab -- the address it replaced itself with, in the GUARD page lines, says \
what it got: a guest's view type other than kExtensionPopup, a tab id from a \
SessionTabHelper AttachTabHelpers gave it, or an error"
  ;;
"tray 1 1 1 1 1 0 "*)
  FAILURE="the popup showed and its window.close() never reached the shell: \
the renderer refused it, WebViewGuest::CloseContents did not send \
CloseRequested, or the element did not dispatch domicile-close"
  ;;
"tray 1 1 1 1 1 1 0")
  FAILURE="the popup showed and the <webview> never reported its content at \
the fixture's size: the guest's renderer was not put in preferred-size mode \
(WebViewGuest::PrimaryPageChanged), WebViewGuest::UpdatePreferredSize did not \
send ContentSizeChanged, or the element did not dispatch \
domicile-content-size-change. The GUARD size lines above say what did arrive"
  ;;
"control 1 1 0 1 0 0 0")
  PASSED="the control is sharp: an empty list left the fixture out of a tray \
the shell did hear, and a page that never asked runtime.getContexts or called \
window.close() showed, answered nothing, stayed, and was not the fixture's \
size -- so the claim's row is the list's and its answer, size and close are \
the popup's"
  ;;
"control 0 "*)
  FAILURE="the list was never sent in the control, so its empty tray answers \
nothing: the shell's control channel did not bind"
  ;;
"control 1 0 "*)
  FAILURE="the control heard no extensions event, so the fixture's absence from \
it is not a reading: ExtensionTray did not bind or did not send"
  ;;
"control 1 1 1 "*)
  FAILURE="the fixture was in the tray with an empty list, so the engine \
installed an extension it was not told to, or the profile was not fresh, and \
the claim's row proves nothing"
  ;;
"control 1 1 0 0 "*)
  FAILURE="the control's page never showed in the <webview>, so the missing \
close is not a reading. The guest, or the page server"
  ;;
"control 1 1 0 1 1 "*)
  FAILURE="a page that never asked runtime.getContexts showed an answer, so \
the claim's answer is not the popup's"
  ;;
"control 1 1 0 1 0 1 "*)
  FAILURE="domicile-close fired for a page that never called window.close(), so \
the claim's close is not the popup's"
  ;;
"control 1 1 0 1 0 0 1")
  FAILURE="a page that is not the fixture reported the fixture's size, so the \
claim's size is not the popup's"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the run did \
not get as far as reading, or ran a leg this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-extension-tray: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
tail -40 "$ENGINE_LOG" >&2
if [ "$NEGATIVE" = "1" ]; then
  echo "what the server was asked for:" >&2
  tail -20 "$HTTP_LOG" >&2
fi
exit 1
