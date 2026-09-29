#!/usr/bin/env bash
# Which end the extension-installer guard blames, and which answers it calls a
# pass.
#
# The unit is the verdict block in `guard-extension-installer.sh`, run out of
# the real script rather than copied, as `test-webview-content-script-guard.sh`
# does. The cases that matter most: a run whose list never crossed the socket
# must fail whatever its probe read, because "not installed" and "never told"
# are the same picture -- and so is a control that saw nothing because nothing
# was sent.
#
# Plus what the guard cannot check at runtime: the color it looks for is the
# one the fixture extension paints, and the message it sends is spelled as the
# compositor writes it and as the engine reads it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-installer.sh"
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

# MEASURED is "<run> <probe status> <whether the list was sent>".
echo "the claim — the list names the fixture, and the <webview> is marked"
expect "sent and marked is a pass" "pass" "$(verdict "installed 0 1")"
expect "sent and unmarked is a failure" "fail" "$(verdict "installed 1 1")"
expect "and blames the installer" "yes" "$(says "installed 1 1" "installer")"
expect "never sent is a failure" "fail" "$(verdict "installed 1 0")"
expect "and blames the control channel, not the installer" "yes" \
  "$(says "installed 1 0" "control channel")"
expect "marked though never sent is a failure" "fail" \
  "$(verdict "installed 0 0")"
expect "nothing measured is a failure" "fail" "$(verdict "installed 2 1")"
expect "and blames the harness" "yes" "$(says "installed 2 1" "harness")"
expect "an unusable probe fails" "fail" "$(verdict "installed 3 1")"
expect "and a killed one does not pass either" "fail" \
  "$(verdict "installed 137 1")"

echo
echo "the control — the same run, the list empty"
expect "sent, drawn and unmarked is the pass" "pass" "$(verdict "control 1 1")"

# INVERTED: the mark is the failure.
expect "a mark from an empty list is a failure" "fail" \
  "$(verdict "control 0 1")"
expect "and says the installer added what it was not told to" "yes" \
  "$(says "control 0 1" "not told")"

# THE CASE THE SENT READING IS FOR: an absence nothing was asked about.
expect "unmarked but never sent is a failure" "fail" \
  "$(verdict "control 1 0")"
expect "a guest that never drew is a failure" "fail" \
  "$(verdict "control 2 1")"
expect "an unusable probe fails the control" "fail" "$(verdict "control 3 1")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0 1")"

echo
echo "the fixture"
COLOR="$(sed -n 's/^readonly COLOR="\([0-9A-F]\{6\}\)"$/\1/p' "$GUARD")"
expect "the guard names its color" "yes" \
  "$([ -n "$COLOR" ] && echo yes || echo no)"
expect "and the content script paints it" "yes" \
  "$(grep -qi "#$COLOR" "$SCRIPTS/guard-webview-content-script-extension/content.js" 2>/dev/null &&
    echo yes || echo no)"

# The compositor's spelling, from the wire fixture `domicile-protocol` is held
# to: a message the stand-in spells differently is one the engine drops, and
# the guard would blame the installer for it.
WIRE="$ROOT/packages/domicile-protocol/wire/host-messages.jsonl"
expect "the wire has an extensions line" "yes" \
  "$(grep -q '"type":"extensions","web_store":\[' "$WIRE" && echo yes || echo no)"
expect "and the stand-in sends that type with those fields" "yes" \
  "$(grep -q '"type": "extensions", "web_store": ' \
    "$SCRIPTS/guard-extension-installer-compositor.py" 2>/dev/null &&
    grep -q '"unpacked": ' "$SCRIPTS/guard-extension-installer-compositor.py" &&
    echo yes || echo no)"
CHANNEL="$ROOT/packages/domicile-engine/src/components/domicile/browser/control_channel.cc"
expect "and the engine dispatches on that type and reads those fields" "yes" \
  "$(grep -q '\*type == "extensions"' "$CHANNEL" &&
    grep -q 'Strings(message, "web_store")' "$CHANNEL" &&
    grep -q 'Strings(message, "unpacked")' "$CHANNEL" &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-installer guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
