#!/usr/bin/env bash
# Tests the verdict of `guard-webview-tabs.sh`: which readings pass and which
# component a failure blames.
#
# Runs the verdict block from the real guard. Key cases: the popup's answer
# names the other <webview>, so the active tab is not the focused one. Only
# the control, which focuses the other window, separates following focus from
# coincidence. Likewise for the zoom the popup sets.
#
# Also checks that the expected id matches the fixture's key and that the
# fixture requests what the guard reads.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-tabs.sh"
FIXTURE="$SCRIPTS/guard-webview-tabs-extension"
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

# MEASURED is "<leg> <sent> <tray> <shown> <focused> <answered> <named-a>
# <named-b> <zoomed-a> <zoomed-b> <read>", each 0 or 1:
#   sent      the stand-in sent the list
#   tray      the fixture's popup was in the tray
#   shown     both windows showed their pages
#   focused   the shell focused its window
#   answered  the popup answered
#   named-a   the answer named window a's page
#   named-b   the answer named window b's page
#   zoomed-a  window a's element received the popup's tabs.setZoom
#   zoomed-b  window b's element received it
#   read      the popup's tabs.getZoom read it back
echo "the claim — window a focused, and the popup names it and zooms it"
expect "a, zoomed and read back, is the pass" "pass" \
  "$(verdict "tabs 1 1 1 1 1 1 0 1 0 1")"
expect "a list never sent is a failure" "fail" \
  "$(verdict "tabs 0 0 0 0 0 0 0 0 0 0")"
expect "and blames the control channel" "yes" \
  "$(says "tabs 0 0 0 0 0 0 0 0 0 0" "control channel")"
expect "no popup in the tray is a failure" "fail" \
  "$(verdict "tabs 1 0 1 0 0 0 0 0 0 0")"
expect "windows that never showed are a failure" "fail" \
  "$(verdict "tabs 1 1 0 0 0 0 0 0 0 0")"
expect "a popup that never answered is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 0 0 0 0 0 0")"
expect "and blames the lookups" "yes" \
  "$(says "tabs 1 1 1 1 0 0 0 0 0 0" "tabs.query")"
expect "an answer naming neither is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 0 0 0 0 0")"
expect "and says the desk found no tab" "yes" \
  "$(says "tabs 1 1 1 1 1 0 0 0 0 0" "no active tab")"

# The case the guard exists for: an answer naming the wrong window.
expect "naming b is a failure" "fail" "$(verdict "tabs 1 1 1 1 1 0 1 0 1 1")"
expect "and says focus was not followed" "yes" \
  "$(says "tabs 1 1 1 1 1 0 1 0 1 1" "focus")"

# Only the named tab is zoomed, and its element reports it.
expect "a zoom no element heard is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0 0 0 0")"
expect "and blames the desk's tabs.setZoom" "yes" \
  "$(says "tabs 1 1 1 1 1 1 0 0 0 0" "tabs.setZoom")"
expect "a zoom read back that no element heard is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0 0 0 1")"
expect "and blames the element's report" "yes" \
  "$(says "tabs 1 1 1 1 1 1 0 0 0 1" "ZoomChanged")"
expect "zooming both windows is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0 1 1 1")"
expect "and says it spread" "yes" \
  "$(says "tabs 1 1 1 1 1 1 0 1 1 1" "other window")"
expect "zooming the window not named is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0 0 1 1")"
expect "a zoom getZoom does not read back is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0 1 0 0")"
expect "and blames tabs.getZoom" "yes" \
  "$(says "tabs 1 1 1 1 1 1 0 1 0 0" "tabs.getZoom")"

echo
echo "the control — window b focused, and the popup must not name or zoom a"
expect "b, zoomed and read back, is the pass" "pass" \
  "$(verdict "control 1 1 1 1 1 0 1 0 1 1")"
# Inverted: a is the failure, because it is the claim's reading.
expect "naming a is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1 1 0 1 0 1")"
expect "and says the claim's answer is not focus's" "yes" \
  "$(says "control 1 1 1 1 1 1 0 1 0 1" "first made")"
# Also inverted: naming b and zooming a means setZoom always hits one tab.
expect "naming b and zooming a is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1 0 1 1 0 1")"
expect "and says the zoom is not the named tab's" "yes" \
  "$(says "control 1 1 1 1 1 0 1 1 0 1" "whichever")"
expect "an unzoomed control is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1 0 1 0 0 0")"
expect "no answer is a failure, not a pass" "fail" \
  "$(verdict "control 1 1 1 1 0 0 0 0 0 0")"
expect "an unfocused control is a failure" "fail" \
  "$(verdict "control 1 1 1 0 0 0 0 0 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" \
  "$(verdict "elephant 1 1 1 1 1 1 0 1 0 1")"
expect "and so is the old shape, without the zoom" "fail" \
  "$(verdict "tabs 1 1 1 1 1 1 0")"

echo
echo "the fixture"
ID="$(sed -n 's/^readonly ID="\([a-p]\{32\}\)"$/\1/p' "$GUARD")"
KEY="$(sed -n 's/^ *"key": "\([^"]*\)",$/\1/p' "$FIXTURE/manifest.json")"
MADE="$(printf '%s' "$KEY" | base64 -d 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
expect "the guard names an id" "yes" "$([ -n "$ID" ] && echo yes || echo no)"
expect "and it is the one the fixture's key makes" "$ID" "$MADE"
expect "the popup asks the question the guard is about" "yes" \
  "$(grep -qF 'query({ active: true, currentWindow: true })' \
    "$FIXTURE/popup.js" && echo yes || echo no)"
expect "and zooms the tab it names, then reads it back" "yes" \
  "$(grep -qF '.setZoom(tab.id, ZOOM)' "$FIXTURE/popup.js" &&
    grep -qF '.getZoom(tab.id)' "$FIXTURE/popup.js" && echo yes || echo no)"
expect "by the factor the guard reads" "yes" \
  "$(grep -qF 'const ZOOM = 1.5;' "$FIXTURE/popup.js" &&
    grep -qF 'readonly ZOOM="1.50"' "$GUARD" && echo yes || echo no)"
expect "and the two windows are two sites, so a site's zoom is one's" "yes" \
  "$(grep -qF 'A="http://127.0.0.1:$PORT/page?a"' "$GUARD" &&
    grep -qF 'B="http://localhost:$PORT/page?b"' "$GUARD" && echo yes || echo no)"
expect "and may read the answer's url" "yes" \
  "$(grep -qF '"permissions": ["tabs"]' "$FIXTURE/manifest.json" &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the webview-tabs guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
