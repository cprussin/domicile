#!/usr/bin/env bash
# Which end the Escape guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-escape.sh` — the `if` chain
# that turns four readings and the run's mode into either a pass or one
# sentence naming an end. It is worth a test of its own for the reason the
# keyboard guard's is: THE CLAIM IS AN ABSENCE. "No process dumped a signal"
# is what a working engine looks like and also what a guard that pressed
# nothing, at a browser with no guest in it, looks like — so the order of the
# gates is the whole of what separates the two, and an ordered chain is a thing
# that can be got wrong in a way no failing engine would ever reveal.
#
# It matters most for the readings a verdict written by symmetry gets backward:
#
#   in the control, the crash is the PASS — the control kills the browser on
#     purpose, and a control that noticed nothing is a guard that cannot tell a
#     dead browser from a live one
#   in the control, a debugging port that still answers is a FAILURE for the
#     same reason: both readings have to move when the browser dies, or the
#     positive run's silence is not a measurement
#   a browser that stopped answering with NO signal in the log is not the bug
#     this guard is about, and must not be reported as it
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-escape.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi` in the
# control's arm is indented, and the block stops before the `if [ -n "$PASSED" ]`
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

# A run in which everything the guard wants is true; each case below changes
# one reading. Written as a baseline plus overrides rather than four positional
# arguments, because a case that says `SAW_CRASH=1` says what it is testing and
# a case that says `1 1 1 0` does not.
readings() { # $1 NEGATIVE, then NAME=value overrides
  SAW_GUEST=1
  PRESSED_BEFORE=1
  SAW_CRASH=0
  PRESSED_AFTER=1
  NEGATIVE="$1"
  shift
  for override in "$@"; do
    eval "$override"
  done
}

verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
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
# pinned them would fail for edits that changed no behavior.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
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
# No guest is no embedder: `browser_plugin_embedder_` is made when a guest is
# attached, and it is the field the crash is reached through. A run without one
# presses Escape at an ordinary browser and establishes nothing — which is the
# state a guard whose <webview> silently stopped working would sit in for ever.
expect "no guest is a failure" "fail" "$(verdict 0 SAW_GUEST=0)"
# AND IN THE CONTROL, which is the arm a verdict written as "the control passes
# when it sees the crash" gets wrong: the control kills the browser itself, so
# its crash reading fires whether or not the run was ever set up.
expect "no guest is a failure in the control too" "fail" \
  "$(verdict 1 SAW_GUEST=0 SAW_CRASH=1 PRESSED_AFTER=0)"
expect "no guest names the guest" "yes" "$(blames "guest" 0 SAW_GUEST=0)"
expect "a key that could not be driven is a failure" "fail" \
  "$(verdict 0 PRESSED_BEFORE=0)"
expect "a key that could not be driven is a failure in the control too" "fail" \
  "$(verdict 1 PRESSED_BEFORE=0 SAW_CRASH=1 PRESSED_AFTER=0)"
expect "a key that could not be driven blames the harness" "yes" \
  "$(blames "harness" 0 PRESSED_BEFORE=0)"

echo
echo "the run — a plain Escape at a shell with a browser window on it"
expect "an engine that survived is the pass" "pass" "$(verdict 0)"
expect "a signal in the log is the failure" "fail" "$(verdict 0 SAW_CRASH=1)"
# The one place in the series that has ever answered this failure, so the
# annotation says it rather than leaving the next person to find it again.
expect "a signal names where it landed" "yes" \
  "$(blames "browser_plugin_embedder" 0 SAW_CRASH=1)"
# NOT THE SAME FAILURE, and reporting it as one would send somebody to the
# wrong file: a browser that went away without dumping a signal was not killed
# by the press this guard is about.
expect "a port that stopped answering with no signal is a failure" "fail" \
  "$(verdict 0 PRESSED_AFTER=0)"
expect "a port that stopped answering with no signal says no signal" "yes" \
  "$(blames "no signal" 0 PRESSED_AFTER=0)"
expect "a signal is named before the port it also silenced" "yes" \
  "$(blames "browser_plugin_embedder" 0 SAW_CRASH=1 PRESSED_AFTER=0)"

echo
echo "the control — the browser is killed on purpose, and both readings must move"
expect "a crash the control caused is the pass" "pass" \
  "$(verdict 1 SAW_CRASH=1 PRESSED_AFTER=0)"
expect "a control that noticed nothing is a failure" "fail" "$(verdict 1)"
expect "a control that noticed nothing says the run establishes nothing" "yes" \
  "$(blames "establishes nothing" 1)"
# HALF A CONTROL IS NOT ONE. A debugging port that answers after the browser
# was killed means the liveness reading answers for something else — a stale
# port, a second browser — and the positive run leans on it.
expect "a control whose port still answers is a failure" "fail" \
  "$(verdict 1 SAW_CRASH=1)"
expect "a control whose port still answers names the port" "yes" \
  "$(blames "debugging port" 1 SAW_CRASH=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the Escape guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
