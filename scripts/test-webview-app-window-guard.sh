#!/usr/bin/env bash
# Tests the verdict of `guard-webview-app-window.sh`: which readings pass and
# which component a failure blames.
#
# The run opens the subject as an app window and the control as an ordinary
# one, so the run passes when the subject is unrecorded and listed `isApp`,
# and the control when it is recorded and not. Runs the verdict block from the
# real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-app-window.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

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

# A passing run of the given mode; each case changes one reading.
readings() { # $1 NEGATIVE, then NAME=value overrides
  NEGATIVE="$1"
  SAW_SHELL=1
  SAW_CRASH=0
  OPENED_SUBJECT=1
  SAW_WINDOW=1
  SAW_SUBJECT=1
  OPENED_SENTINEL=1
  SAW_SENTINEL=1
  if [ "$NEGATIVE" = "1" ]; then
    WINDOW_APP=0
    SUBJECT_RECORDED=1
  else
    WINDOW_APP=1
    SUBJECT_RECORDED=0
  fi
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

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(
    readings "$@"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "no shell is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a crash is a failure" "fail" "$(verdict 0 SAW_CRASH=1)"
expect "an unanswered open_url is a failure" "fail" \
  "$(verdict 0 OPENED_SUBJECT=0)"
expect "and names the command socket" "yes" \
  "$(blames "command socket" 0 OPENED_SUBJECT=0)"
expect "an unlisted window is a failure" "fail" "$(verdict 0 SAW_WINDOW=0)"
expect "a subject page that never loaded is a failure" "fail" \
  "$(verdict 0 SAW_SUBJECT=0)"
expect "an unopened sentinel is a failure" "fail" \
  "$(verdict 0 OPENED_SENTINEL=0)"
expect "an unrecorded sentinel is a failure" "fail" \
  "$(verdict 0 SAW_SENTINEL=0)"
expect "and names AttachTabHelpers" "yes" \
  "$(blames "AttachTabHelpers" 0 SAW_SENTINEL=0)"

echo
echo "the run — the subject opened as an app window"
expect "listed isApp and unrecorded: pass" "pass" "$(verdict 0)"
expect "not listed isApp is a failure" "fail" "$(verdict 0 WINDOW_APP=0)"
expect "and names DeskWindows::List" "yes" \
  "$(blames "DeskWindows::List" 0 WINDOW_APP=0)"
expect "a recorded visit is a failure" "fail" \
  "$(verdict 0 SUBJECT_RECORDED=1)"
expect "and names AttachAppTabHelpers" "yes" \
  "$(blames "AttachAppTabHelpers" 0 SUBJECT_RECORDED=1)"

echo
echo "the control — the subject opened as an ordinary window"
expect "not listed isApp and recorded: pass" "pass" "$(verdict 1)"
expect "listed isApp is a failure" "fail" "$(verdict 1 WINDOW_APP=1)"
expect "an unrecorded visit is a failure" "fail" \
  "$(verdict 1 SUBJECT_RECORDED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the app window guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
