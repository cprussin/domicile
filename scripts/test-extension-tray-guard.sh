#!/usr/bin/env bash
# Which end the extension-tray guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-extension-tray.sh`, run out of the
# real script rather than copied, as `test-extension-installer-guard.sh` does.
# The cases that matter most: a control that saw no fixture must also have
# heard a tray at all, because "not in the tray" and "no tray" are the same
# absence -- a control whose page closed had a close nobody asked for -- and a
# popup that never answered runtime.getContexts took the browser with it.
#
# Plus what the guard cannot check at runtime: the id it expects is the one the
# fixture's key makes, and the badge it reads is the one the fixture sets.
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

# Pass or fail, not the sentence: the sentences will be reworded.
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

# Whether the failing sentence names `$2`, where WHICH end it blames is the
# point.
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

# MEASURED is "<leg> <sent> <heard> <tray> <opened> <contexts> <closed>":
# whether the stand-in sent the list, whether the page heard any `extensions`
# event, whether the fixture's row was in it (as expected, for the claim; at
# all, for the control), whether the <webview> showed its page, whether the
# popup's runtime.getContexts listed it as a TAB (any answer at all, for the
# control), and whether the <webview> dispatched `domicile-close` (after any
# answer, for the claim).
echo "the claim — the fixture in the tray, its popup opened, asked and closed"
expect "all six is a pass" "pass" "$(verdict "tray 1 1 1 1 1 1")"
expect "a list never sent is a failure" "fail" "$(verdict "tray 0 1 1 1 1 1")"
expect "and blames the control channel" "yes" \
  "$(says "tray 0 0 0 0 0 0" "control channel")"
expect "no tray heard is a failure" "fail" "$(verdict "tray 1 0 0 0 0 0")"
expect "and blames the tray's binding" "yes" \
  "$(says "tray 1 0 0 0 0 0" "ExtensionTray")"
expect "a tray without the fixture's row is a failure" "fail" \
  "$(verdict "tray 1 1 0 0 0 0")"
expect "and says which row" "yes" "$(says "tray 1 1 0 0 0 0" "row")"
expect "a popup that never showed is a failure" "fail" \
  "$(verdict "tray 1 1 1 0 0 0")"
expect "and blames the navigation" "yes" \
  "$(says "tray 1 1 1 0 0 0" "chrome-extension://")"

# THE CASE THE CONTEXTS READING IS FOR: getContexts on a guest with no view
# type is a NOTREACHED, which takes the browser down before any answer.
expect "a popup that never answered is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 0 0")"
expect "and blames the guest's view type" "yes" \
  "$(says "tray 1 1 1 1 0 0" "kTabContents")"
expect "a popup that answered anything but TAB is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 0 1")"
expect "and says what it was asked" "yes" \
  "$(says "tray 1 1 1 1 0 1" "getContexts")"
expect "a popup that never closed is a failure" "fail" \
  "$(verdict "tray 1 1 1 1 1 0")"
expect "and blames the close" "yes" "$(says "tray 1 1 1 1 1 0" "CloseContents")"

echo
echo "the control — the list empty, a page that never closes"
expect "heard, absent, shown, unasked and open is the pass" "pass" \
  "$(verdict "control 1 1 0 1 0 0")"

# THE CASE THE HEARD READING IS FOR: an absence nothing was asked about.
expect "no tray heard is a failure" "fail" "$(verdict "control 1 0 0 1 0 0")"
expect "the fixture from an empty list is a failure" "fail" \
  "$(verdict "control 1 1 1 1 0 0")"
expect "and says so" "yes" "$(says "control 1 1 1 1 0 0" "not told")"
expect "a page that never showed is a failure" "fail" \
  "$(verdict "control 1 1 0 0 0 0")"
expect "an answer from a page that asked nothing is a failure" "fail" \
  "$(verdict "control 1 1 0 1 1 0")"

# INVERTED: the close is the failure.
expect "a close from a page that never asked is a failure" "fail" \
  "$(verdict "control 1 1 0 1 0 1")"
expect "and says so" "yes" "$(says "control 1 1 0 1 0 1" "never called")"
expect "a list never sent fails the control too" "fail" \
  "$(verdict "control 0 1 0 1 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" "$(verdict "elephant 1 1 1 1 1 1")"

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
# ARGB as the page reads it, #rrggbbaa, from the #RRGGBB the worker sets.
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
CONTEXT="$(sed -n 's/^readonly CONTEXT="\(.*\)"$/\1/p' "$GUARD")"
expect "the guard expects the popup to be a TAB, as Chrome's tab is" "TAB" \
  "$CONTEXT"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-tray guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
