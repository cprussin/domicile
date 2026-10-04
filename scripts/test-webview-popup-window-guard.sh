#!/usr/bin/env bash
# Tests the verdict of `guard-webview-popup-window.sh`: which readings pass and
# which component a failure blames.
#
# Runs the verdict block from the real guard. Key case: the shell opens the
# window, but its <webview> is a tab of the desktop window, not of a popup
# window. The control opens the same <webview> without `popupwindow` to show
# that the attribute creates the popup window.
#
# Also checks that the expected id matches the fixture's key and that the
# fixture requests what the guard reads.
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

# Prints pass, fail or neither. Sentences are not compared, since they change.
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

# Whether the failure message contains `$2`, i.e. blames the right component.
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
# <found> <closed> <created>", each 0 or 1:
#   sent     the stand-in sent the list
#   tray     the fixture's popup was in the tray
#   shown    the shell's browser window showed its page
#   asked    the shell received `domicile-popup-window`
#   sized    with the size the fixture requested
#   typed    the window's page saw its window as a `popup`
#   same     that window was the one the event named
#   found    tabs.query({windowType: "popup"}) found its tab
#   closed   the shell received windows.remove as `domicile-close`
#   created  windows.create returned the window
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

# The case the guard exists for: the shell opened it, but it is not a popup
# window.
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
# Inverted: a popup window is the failure, because it is the claim's reading.
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
