#!/usr/bin/env bash
# Tests the verdict of `guard-webview-escape.sh`: which readings pass and which
# component a failure blames.
#
# The guard checks for an absence: no process dumped a signal. A guard that
# pressed nothing at a browser with no guest sees the same, so the order of
# the checks matters. Easy to get backward:
#
#   - In the control, the crash is the pass: the control kills the browser on
#     purpose.
#   - In the control, a debugging port that still answers is a failure. Both
#     readings must change when the browser dies, or the run's silence
#     measures nothing.
#   - A browser that stopped answering with no signal in the log is a
#     different bug and must not be reported as this one.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-escape.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the column-zero `fi` that ends the decision. The nested
# `fi` is indented, so the match cannot stop early.
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

# Sets every reading to its passing value; each case overrides one by name,
# which reads better than positional arguments.
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

# The failure message, for cases that check which component it blames. Tests
# match a keyword, not the whole sentence.
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
# With no guest there is no `browser_plugin_embedder_`, the field the crash
# goes through, so the run proves nothing.
expect "no guest is a failure" "fail" "$(verdict 0 SAW_GUEST=0)"
# The control must fail too: it kills the browser itself, so its crash
# reading fires even when setup failed.
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
# The message names the code that caused this crash.
expect "a signal names where it landed" "yes" \
  "$(blames "browser_plugin_embedder" 0 SAW_CRASH=1)"
# A browser that exited without a signal was not killed by this press, so it
# gets a different message.
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
# A port that answers after the kill means the liveness reading is measuring
# something else (a stale port, a second browser), and the run relies on it.
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
