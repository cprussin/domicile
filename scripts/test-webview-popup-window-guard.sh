#!/usr/bin/env bash
# Which end the webview-popup-window guard blames, and which answers it calls a
# pass.
#
# The unit is the verdict block in `guard-webview-popup-window.sh`, run out of
# the real script rather than copied, as `test-webview-tabs-guard.sh` does. The
# cases that matter most are the ones where the shell opened the window and the
# extension still did not get one: a <webview> that is a tab of the desk rather
# than of the popup window. Only the control, which opens the same <webview>
# without `popupwindow`, can tell a window the attribute made from one that
# would have been there anyway.
#
# Plus what the guard cannot check at runtime: the id it expects is the one the
# fixture's key makes, and the fixture asks what the guard reads.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-popup-window.sh"
FIXTURE="$SCRIPTS/guard-webview-popup-window-extension"
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

# MEASURED is "<leg> <sent> <tray> <shown> <asked> <sized> <typed> <same>
# <found> <closed> <created>": whether the stand-in sent the list, whether the
# fixture's popup was in the tray, whether the shell's browser window showed
# its page, whether the shell heard `domicile-popup-window`, whether it carried
# the size the fixture asked for, whether the window's page called its window a
# `popup`, whether that window was the one the event named, whether
# tabs.query({windowType: "popup"}) found its tab, whether the shell heard the
# window's windows.remove as `domicile-close`, and whether windows.create
# answered with the window.
echo "the claim — the shell names the window, and the page is its tab"
expect "a popup window, found, removed and answered, is the pass" "pass" \
  "$(verdict "popup 1 1 1 1 1 1 1 1 1 1")"
expect "a list never sent is a failure" "fail" \
  "$(verdict "popup 0 0 0 0 0 0 0 0 0 0")"
expect "and blames the control channel" "yes" \
  "$(says "popup 0 0 0 0 0 0 0 0 0 0" "control channel")"
expect "no popup in the tray is a failure" "fail" \
  "$(verdict "popup 1 0 1 0 0 0 0 0 0 0")"
expect "a browser window that never showed is a failure" "fail" \
  "$(verdict "popup 1 1 0 0 0 0 0 0 0 0")"
expect "a shell never asked is a failure" "fail" \
  "$(verdict "popup 1 1 1 0 0 0 0 0 0 0")"
expect "and blames windows.create" "yes" \
  "$(says "popup 1 1 1 0 0 0 0 0 0 0" "windows.create")"
expect "the wrong size is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 0 1 1 1 1 1")"
expect "and blames the size carried" "yes" \
  "$(says "popup 1 1 1 1 0 1 1 1 1 1" "size")"

# THE CASE THE GUARD IS FOR: the shell opened it, and it is not a popup window.
expect "a page in the desk's window is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 1 0 0 0 0 0")"
expect "and blames popupwindow" "yes" \
  "$(says "popup 1 1 1 1 1 0 0 0 0 0" "popupwindow")"
expect "a popup window that is not the one asked for is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 1 1 0 1 1 1")"
expect "a popup tabs.query cannot find is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 1 1 1 0 1 1")"
expect "and blames tabs.query" "yes" \
  "$(says "popup 1 1 1 1 1 1 1 0 1 1" "tabs.query")"
expect "a windows.remove the shell never hears is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 1 1 1 1 0 1")"
expect "and blames windows.remove" "yes" \
  "$(says "popup 1 1 1 1 1 1 1 1 0 1" "windows.remove")"
expect "a windows.create that never answers is a failure" "fail" \
  "$(verdict "popup 1 1 1 1 1 1 1 1 1 0")"

echo
echo "the control — the same <webview> without popupwindow"
expect "a desk tab, unfound, unclosed and unanswered, is the pass" "pass" \
  "$(verdict "control 1 1 1 1 1 0 0 0 0 0")"
# INVERTED: a popup window is the failure, because it is the claim's reading.
expect "a popup window anyway is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1 1 1 1 1 1")"
expect "and says the claim's window is not the attribute's" "yes" \
  "$(says "control 1 1 1 1 1 1 1 1 1 1" "without")"
expect "a desk window removed is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1 0 0 0 1 0")"
expect "and says the desk's window was closed" "yes" \
  "$(says "control 1 1 1 1 1 0 0 0 1 0" "desk")"
expect "a shell never asked is a failure, not a pass" "fail" \
  "$(verdict "control 1 1 1 0 0 0 0 0 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" \
  "$(verdict "elephant 1 1 1 1 1 1 1 1 1 1")"

echo
echo "the fixture"
ID="$(sed -n 's/^readonly ID="\([a-p]\{32\}\)"$/\1/p' "$GUARD")"
KEY="$(sed -n 's/^ *"key": "\([^"]*\)",$/\1/p' "$FIXTURE/manifest.json")"
MADE="$(printf '%s' "$KEY" | base64 -d 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
expect "the guard names an id" "yes" "$([ -n "$ID" ] && echo yes || echo no)"
expect "and it is the one the fixture's key makes" "$ID" "$MADE"
expect "the popup asks for the window the guard is about" "yes" \
  "$(grep -qF '.create({' "$FIXTURE/popup.js" &&
    grep -qF 'type: "popup", url: "window.html"' "$FIXTURE/popup.js" &&
    echo yes || echo no)"
expect "at the size the guard reads" "yes" \
  "$(grep -qF 'width: 420' "$FIXTURE/popup.js" &&
    grep -qF 'height: 360' "$FIXTURE/popup.js" &&
    grep -qF 'readonly WIDTH="420"' "$GUARD" &&
    grep -qF 'readonly HEIGHT="360"' "$GUARD" && echo yes || echo no)"
expect "and the window asks where it is, and removes it" "yes" \
  "$(grep -qF 'windows.getCurrent()' "$FIXTURE/window.js" &&
    grep -qF 'query({ windowType: "popup" })' "$FIXTURE/window.js" &&
    grep -qF 'windows.remove(' "$FIXTURE/window.js" && echo yes || echo no)"
expect "and may read a tab's url" "yes" \
  "$(grep -qF '"permissions": ["tabs"]' "$FIXTURE/manifest.json" &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the webview-popup-window guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
