#!/usr/bin/env bash
# Which end the keyboard guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-keyboard.sh` — the `if` chain
# that turns nine readings and the run's mode into either a pass or one
# sentence naming an end. The readings are not independent: a run that never
# claimed a chord has established nothing about what fires, and a run where the
# browser window never took the keyboard is not a run about browser windows at
# all. So the chain is ordered, and an ordered chain is a thing that can be got
# wrong in a way no failing engine would ever reveal — the wrong arm answers,
# with a true-sounding sentence about the wrong layer, and the next person
# spends a CI cycle on it.
#
# It matters most for the three readings a verdict written by symmetry gets
# backwards:
#
#   in the negative run, the chord FIRING is the failure
#   the shell's document seeing an ungrabbed key is a failure even though
#     nothing about the desktop's own chords broke — the answer recorded in
#     `WebViewGuest::PreHandleKeyboardEvent`'s own comment would be wrong, and
#     a guard that passed would leave it wrong
#   the shell's document seeing NO key at all, before focus ever moved, is a
#     PASS — one reading short and saying so. Everything the guard claims is
#     measured in the browser process; whether a page then receives a DOM event
#     is a layer below, and a browser with no display for its window to be
#     activated on may deliver none to anybody
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-keyboard.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi` in the
# negative arm is indented, and the block stops before the `if [ -n "$PASSED" ]`
# below it — a verdict is a value here, not a status.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
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

# A run in which everything the guard wants is true; each case below changes one
# reading. Written as a baseline plus overrides rather than nine positional
# arguments, because a case that says `SAW_MODIFIERS=0` says what it is testing
# and a case that says `1 1 0 1 0 0 1 0 0` does not.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_CLAIM=1
    SAW_PAGE=1
    SAW_FOCUS=1
    SAW_RELAY=0
    SAW_SHORTCUT=1
    SAW_MODIFIERS=1
    SAW_HOOK=1
    SAW_SHELL_KEY=1
    SAW_DOCUMENT_KEY=0
    SAW_GUEST_KEY=0
    NEGATIVE="$1"
    shift
    for override in "$@"; do
      eval "$override"
    done
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

# The failing sentence, for the cases where WHICH end it names is the point. Not
# the whole wording: sentences are prose and will be reworded, and a test that
# pinned them would fail for edits that changed no behaviour.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_CLAIM=1
    SAW_PAGE=1
    SAW_FOCUS=1
    SAW_RELAY=0
    SAW_SHORTCUT=1
    SAW_MODIFIERS=1
    SAW_HOOK=1
    SAW_SHELL_KEY=1
    SAW_DOCUMENT_KEY=0
    SAW_GUEST_KEY=0
    NEGATIVE="$1"
    shift
    for override in "$@"; do
      eval "$override"
    done
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(reason "$@")" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "no claim is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_CLAIM=0)"
# AND IN THE NEGATIVE RUN, which is the arm a verdict written as "the control
# passes when nothing fires" gets wrong: with no claim made, nothing firing is
# what a broken harness looks like too.
expect "no claim is a failure in the negative run" "fail" \
  "$(verdict 1 SAW_CLAIM=0)"
expect "no claim blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CLAIM=0)"
expect "an unfocused window is a failure" "fail" "$(verdict 0 SAW_FOCUS=0)"
expect "an unfocused window is a failure in the negative run too" "fail" \
  "$(verdict 1 SAW_FOCUS=0)"
expect "an unfocused window blames the harness" "yes" \
  "$(blames "harness" 0 SAW_FOCUS=0)"

echo
echo "the claim itself, which the compositor must no longer be told about"
expect "a relayed claim is a failure" "fail" "$(verdict 0 SAW_RELAY=1)"
expect "a relayed claim is a failure in the negative run too" "fail" \
  "$(verdict 1 SAW_RELAY=1)"
expect "a relayed claim names the socket" "yes" \
  "$(blames "control socket" 0 SAW_RELAY=1)"

echo
echo "the positive run — a <webview>, over which the chord must reach the shell"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# An empty window is a guest that was never made, which is PR #257's half
# rather than this one's — and it is asked ONLY of the positive run, because a
# control's <iframe> does not load the page at all and does not need to.
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "no chord is a failure" "fail" "$(verdict 0 SAW_SHORTCUT=0)"
expect "no chord blames the hook" "yes" \
  "$(blames "PreHandleKeyboardEvent" 0 SAW_SHORTCUT=0)"
expect "no modifiers is a failure" "fail" "$(verdict 0 SAW_MODIFIERS=0)"

echo
echo "the open question — where an ungrabbed key ends up"
expect "a key that never reached the guest's hook is a failure" "fail" \
  "$(verdict 0 SAW_HOOK=0)"
expect "a key that never reached the guest's hook decides nothing" "yes" \
  "$(blames "not decided" 0 SAW_HOOK=0)"
# THE INVERTED ONE. Both seeing it is not a regression in anything this change
# built — it would mean the shell's own keys still work over a browser window —
# and it still has to fail, because the answer written down would be wrong.
expect "a key that reached both is a failure" "fail" \
  "$(verdict 0 SAW_DOCUMENT_KEY=1)"
expect "a key that reached both points at where the answer is written down" \
  "yes" "$(blames "in its own comment" 0 SAW_DOCUMENT_KEY=1)"
# THE OTHER ONE. A harness that delivered no key to the shell's document before
# focus moved has not measured the absence after it — and every other claim
# still stands, so this is a pass that says what it is missing rather than a
# failure about a layer the guard does not touch.
expect "no key before focus is still a pass" "pass" \
  "$(verdict 0 SAW_SHELL_KEY=0)"
expect "no key before focus is checked after the readings it cannot excuse" \
  "fail" "$(verdict 0 SAW_SHELL_KEY=0 SAW_SHORTCUT=0)"

echo
echo "the negative run — an <iframe>, over which nothing may fire"
expect "no chord is the pass" "pass" "$(verdict 1 SAW_SHORTCUT=0)"
expect "a chord is the failure" "fail" "$(verdict 1)"
expect "a chord says there is no guest to have matched it" "yes" \
  "$(blames "no guest" 1)"
# The control is a control whatever the rest of the readings say: an <iframe> is
# given every key it is sent, so what is a failure in the positive run is the
# ordinary case here and must not be read as anything.
expect "an empty window is not the control's business" "pass" \
  "$(verdict 1 SAW_SHORTCUT=0 SAW_PAGE=0)"
expect "the modifiers are not the control's business" "pass" \
  "$(verdict 1 SAW_SHORTCUT=0 SAW_MODIFIERS=0)"
expect "an ungrabbed key reaching the document is not the control's business" \
  "pass" "$(verdict 1 SAW_SHORTCUT=0 SAW_DOCUMENT_KEY=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the keyboard guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
