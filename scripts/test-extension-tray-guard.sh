#!/usr/bin/env bash
# Asserts the extension-tray guard's verdict: which answers pass, and which
# end each failure blames.
#
# Runs the verdict block from `guard-extension-tray.sh` itself, as
# `test-extension-installer-guard.sh` does. Key cases: a control that saw no
# fixture must still have heard a tray, since "not in the tray" and "no tray"
# look the same; a control page that closes was never asked to close, so the
# close is a failure; and a popup that never answered runtime.getContexts
# crashed the browser.
#
# Also checks what the guard cannot check at runtime: its expected id matches
# the fixture's key, and its expected badge matches what the fixture sets.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-tray.sh"
FIXTURE="$SCRIPTS/guard-extension-tray-extension"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# Prints pass or fail, not the message, which may be reworded.
verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

# Whether the failure message contains `$2`; the end it blames matters.
says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<leg> <sent> <heard> <tray> <opened> <contexts> <closed>
# <sized>", each 1 or 0:
#   sent      the stand-in sent the list
#   heard     the page heard an `extensionschanged` event
#   tray      the fixture's row was present (as expected for the claim; at all
#             for the control)
#   opened    the <webview> showed its page
#   contexts  runtime.getContexts listed the popup as a POPUP and
#             tabs.getCurrent named no tab (any answer, for the control)
#   closed    the <webview> dispatched `domicile-close` (after any answer, for
#             the claim)
#   sized     it reported the fixture's content size (that size at all, for
#             the control)
echo "the claim — the fixture in the tray, its popup opened, asked and closed"
expect "all seven is a pass" "pass" "$(verdict "tray 1 1 1 1 1 1 1")"
expect "a list never sent is a failure" "fail" "$(verdict "tray 0 1 1 1 1 1 1")"
expect "and blames the control channel" "yes" \
  "$(says "tray 0 0 0 0 0 0 0" "control channel")"
expect "no tray heard is a failure" "fail" "$(verdict "tray 1 0 0 0 0 0 0")"
expect "and blames the tray's binding" "yes" \
  "$(says "tray 1 0 0 0 0 0 0" "ExtensionTray")"
expect "a tray without the fixture's row is a failure" "fail" \
  "$(verdict "tray 1 1 0 0 0 0 0")"
expect "and says which row" "yes" "$(says "tray 1 1 0 0 0 0 0" "row")"
expect "a popup that never showed is a failure" "fail" \
  "$(verdict "tray 1 1 1 0 0 0 0")"
expect "and blames the navigation" "yes" \
  "$(says "tray 1 1 1 0 0 0 0" "chrome-extension://")"

# getContexts on a guest with no view type hits a NOTREACHED, which crashes
# the browser before any answer.
expect "a popup that never answered is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 0 0 1")"
expect "and blames the guest's view type" "yes" \
  "$(says "tray 1 1 1 1 0 0 1" "kExtensionPopup")"
expect "a popup that answered anything but a POPUP in no tab is a failure" \
  "fail" "$(verdict "tray 1 1 1 1 0 1 1")"
expect "and names both things a tab would have" "yes yes" \
  "$(says "tray 1 1 1 1 0 1 1" "kExtensionPopup") $(says "tray 1 1 1 1 0 1 1" "SessionTabHelper")"
expect "a popup that never closed is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 1 0 1")"
expect "and blames the close" "yes" "$(says "tray 1 1 1 1 1 0 1" "CloseContents")"
expect "a popup whose size never arrived is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 1 1 0")"
expect "and blames the preferred size" "yes" \
  "$(says "tray 1 1 1 1 1 1 0" "UpdatePreferredSize")"

echo
echo "the control — the list empty, a page that never closes"
expect "heard, absent, shown, unasked and open is the pass" "pass" \
  "$(verdict "control 1 1 0 1 0 0 0")"

# A control with no fixture proves nothing if the page heard no tray event, so
# it fails.
expect "no tray heard is a failure" "fail" "$(verdict "control 1 0 0 1 0 0 0")"
expect "the fixture from an empty list is a failure" "fail" \
  "$(verdict "control 1 1 1 1 0 0 0")"
expect "and says so" "yes" "$(says "control 1 1 1 1 0 0 0" "not told")"
expect "a page that never showed is a failure" "fail" \
  "$(verdict "control 1 1 0 0 0 0 0")"
expect "an answer from a page that asked nothing is a failure" "fail" \
  "$(verdict "control 1 1 0 1 1 0 0")"

# Inverted: a close is the failure.
expect "a close from a page that never asked is a failure" "fail" \
  "$(verdict "control 1 1 0 1 0 1 0")"
expect "and says so" "yes" "$(says "control 1 1 0 1 0 1 0" "never called")"
expect "a list never sent fails the control too" "fail" \
  "$(verdict "control 0 1 0 1 0 0 0")"
expect "the fixture's size from a page that is not the fixture is a failure" \
  "fail" "$(verdict "control 1 1 0 1 0 0 1")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" "$(verdict "elephant 1 1 1 1 1 1 1")"

echo
echo "the fixture"
ID="$(sed -n 's/^readonly ID="\([a-p]\{32\}\)"$/\1/p' "$GUARD")"
KEY="$(sed -n 's/^ *"key": "\([^"]*\)",$/\1/p' "$FIXTURE/manifest.json")"
MADE="$(printf '%s' "$KEY" | base64 -d 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
expect "the guard names an id" "yes" "$([ -n "$ID" ] && echo yes || echo no)"
expect "and it is the one the fixture's key makes" "$ID" "$MADE"
BADGE="$(sed -n 's/^readonly BADGE="\(.*\)"$/\1/p' "$GUARD")"
BADGE_COLOR="$(sed -n 's/^readonly BADGE_COLOR="\(.*\)"$/\1/p' "$GUARD")"
expect "the service worker sets the badge the guard reads" "yes" \
  "$(grep -qF "setBadgeText({ text: \"$BADGE\" })" "$FIXTURE/background.js" &&
    echo yes || echo no)"
# The page reads ARGB as #rrggbbaa; the worker sets #RRGGBB.
SET_COLOR="$(sed -n 's/.*setBadgeBackgroundColor({ color: "#\([0-9A-F]\{6\}\)" }).*/\1/p' "$FIXTURE/background.js")"
expect "and the color, as the engine spells it" "$BADGE_COLOR" \
  "#$(printf '%s' "$SET_COLOR" | tr 'A-F' 'a-f')ff"
TITLE="$(sed -n 's/^readonly TITLE="\(.*\)"$/\1/p' "$GUARD")"
expect "the manifest's title is the guard's" "yes" \
  "$(grep -qF "\"default_title\": \"$TITLE\"" "$FIXTURE/manifest.json" &&
    echo yes || echo no)"
expect "and its popup closes itself" "yes" \
  "$(grep -q 'window.close()' "$FIXTURE/popup.js" && echo yes || echo no)"
expect "and asks runtime.getContexts first" "yes" \
  "$(grep -qF 'runtime.getContexts({})' "$FIXTURE/popup.js" && echo yes || echo no)"
WIDTH="$(sed -n 's/^readonly WIDTH="\([0-9]*\)"$/\1/p' "$GUARD")"
HEIGHT="$(sed -n 's/^readonly HEIGHT="\([0-9]*\)"$/\1/p' "$GUARD")"
# A fluid layout, like Bitwarden's popup in a tab: two halves of WIDTH side by
# side with no fixed width. Its min-content width is half its natural width,
# so sizing from the narrower value gives a strip.
HALF=$((WIDTH / 2))
expect "and lays its popup out fluid, at the size the guard reads" "2 1 0" \
  "$(grep -oF "display: inline-block; width: ${HALF}px; height: ${HEIGHT}px" "$FIXTURE/popup.html" | wc -l) \
$(grep -cF "<body style=\"margin: 0\">" "$FIXTURE/popup.html") \
$(grep -cF "width: ${WIDTH}px" "$FIXTURE/popup.html")"
CONTEXT="$(sed -n 's/^readonly CONTEXT="\(.*\)"$/\1/p' "$GUARD")"
expect "the guard expects the popup to be a POPUP, as Chrome's is" "POPUP" \
  "$CONTEXT"
CURRENT_TAB="$(sed -n 's/^readonly CURRENT_TAB="\(.*\)"$/\1/p' "$GUARD")"
expect "and in no tab, as Chrome's is" "none" "$CURRENT_TAB"
expect "and its popup asks which tab it is in" "yes" \
  "$(grep -qF 'tabs.getCurrent()' "$FIXTURE/popup.js" && echo yes || echo no)"
expect "and the guard's shell marks the popup an extension popup" "yes" \
  "$(grep -qF 'view.setAttribute("extensionpopup", "")' "$SCRIPTS/guard-extension-tray.js" &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-tray guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
