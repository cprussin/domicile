#!/usr/bin/env bash
# Which end the webview-tabs guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-tabs.sh`, run out of the real
# script rather than copied, as `test-extension-tray-guard.sh` does. The cases
# that matter most are the two that name the wrong window: a popup's answer
# that is the other <webview> is a desk whose active tab is not the focused
# one -- the first made, or the last -- and only the control, which focuses the
# other window, can tell a desk that follows focus from one that happens to
# agree with it.
#
# Plus what the guard cannot check at runtime: the id it expects is the one the
# fixture's key makes, and the fixture asks what the guard reads.
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

# MEASURED is "<leg> <sent> <tray> <shown> <focused> <answered> <named-a>
# <named-b>": whether the stand-in sent the list, whether the fixture's popup
# was in the tray, whether both windows showed their pages, whether the shell
# focused its window, whether the popup answered at all, and whether that
# answer named window a's page, or window b's.
echo "the claim — window a focused, and the popup names it"
expect "a is the pass" "pass" "$(verdict "tabs 1 1 1 1 1 1 0")"
expect "a list never sent is a failure" "fail" "$(verdict "tabs 0 0 0 0 0 0 0")"
expect "and blames the control channel" "yes" \
  "$(says "tabs 0 0 0 0 0 0 0" "control channel")"
expect "no popup in the tray is a failure" "fail" \
  "$(verdict "tabs 1 0 1 0 0 0 0")"
expect "windows that never showed are a failure" "fail" \
  "$(verdict "tabs 1 1 0 0 0 0 0")"
expect "a popup that never answered is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 0 0 0")"
expect "and blames the lookups" "yes" \
  "$(says "tabs 1 1 1 1 0 0 0" "tabs.query")"
expect "an answer naming neither is a failure" "fail" \
  "$(verdict "tabs 1 1 1 1 1 0 0")"
expect "and says the desk found no tab" "yes" \
  "$(says "tabs 1 1 1 1 1 0 0" "no active tab")"

# THE CASE THE GUARD IS FOR: an answer, and the wrong window.
expect "naming b is a failure" "fail" "$(verdict "tabs 1 1 1 1 1 0 1")"
expect "and says focus was not followed" "yes" \
  "$(says "tabs 1 1 1 1 1 0 1" "focus")"

echo
echo "the control — window b focused, and the popup must not name a"
expect "b is the pass" "pass" "$(verdict "control 1 1 1 1 1 0 1")"
# INVERTED: a is the failure, because it is the claim's reading.
expect "naming a is a failure" "fail" "$(verdict "control 1 1 1 1 1 1 0")"
expect "and says the claim's answer is not focus's" "yes" \
  "$(says "control 1 1 1 1 1 1 0" "first made")"
expect "no answer is a failure, not a pass" "fail" \
  "$(verdict "control 1 1 1 1 0 0 0")"
expect "an unfocused control is a failure" "fail" \
  "$(verdict "control 1 1 1 0 0 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" "$(verdict "elephant 1 1 1 1 1 1 0")"

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
