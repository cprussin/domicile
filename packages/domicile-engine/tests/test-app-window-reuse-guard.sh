#!/usr/bin/env bash
# Tests the verdict of `guard-app-window-reuse.sh`: which readings pass and
# which component a failure blames.
#
# The run reuses one window per app id, so it passes with one mail window
# asked to the front twice and one chat window. The control opens a window
# per call, so it passes with three mail windows, two chat windows and no
# focus request. Runs the verdict block from the real guard, so moving it
# fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-app-window-reuse.sh"
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
  OPENED_MAIL=1
  SAW_MAIL=1
  DREW_MAIL=1
  COUNTED=3
  if [ "$NEGATIVE" = "1" ]; then
    NAVIGATED=0
    MAIL_WINDOWS=3
    MAIL_FOCUSED=0
    CHAT_WINDOWS=2
  else
    NAVIGATED=1
    MAIL_WINDOWS=1
    MAIL_FOCUSED=2
    CHAT_WINDOWS=1
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
expect "an unanswered open_url is a failure" "fail" "$(verdict 0 OPENED_MAIL=0)"
expect "and names the command socket" "yes" \
  "$(blames "command socket" 0 OPENED_MAIL=0)"
expect "no listed mail window is a failure" "fail" "$(verdict 0 SAW_MAIL=0)"
expect "and names appId" "yes" "$(blames "appId" 0 SAW_MAIL=0)"
expect "an undrawn mail window is a failure" "fail" "$(verdict 0 DREW_MAIL=0)"

echo
echo "the run — one window per app id"
expect "one mail window, focused twice, one chat window, counted: pass" \
  "pass" "$(verdict 0)"
expect "an unnavigated mail window is a failure" "fail" \
  "$(verdict 0 NAVIGATED=0)"
expect "and names Navigate" "yes" "$(blames "Navigate" 0 NAVIGATED=0)"
expect "a second mail window is a failure" "fail" \
  "$(verdict 0 MAIL_WINDOWS=2)"
expect "and says it was not reused" "yes" \
  "$(blames "NOT REUSED" 0 MAIL_WINDOWS=2)"
expect "no focus request is a failure" "fail" "$(verdict 0 MAIL_FOCUSED=0)"
expect "and names RequestFocus" "yes" \
  "$(blames "RequestFocus" 0 MAIL_FOCUSED=0)"
expect "no chat window is a failure" "fail" "$(verdict 0 CHAT_WINDOWS=0)"
expect "and names openAppWindow" "yes" \
  "$(blames "openAppWindow" 0 CHAT_WINDOWS=0)"
expect "two chat windows is a failure" "fail" "$(verdict 0 CHAT_WINDOWS=2)"
expect "and names BrowserWindowsService::OpenApp" "yes" \
  "$(blames "BrowserWindowsService::OpenApp" 0 CHAT_WINDOWS=2)"
expect "a wrong count is a failure" "fail" "$(verdict 0 COUNTED=0)"
expect "no count is a failure" "fail" "$(verdict 0 COUNTED=)"
expect "and names CountMatches" "yes" \
  "$(blames "CountMatches" 0 COUNTED=)"

echo
echo "the control — a window per call"
expect "three mail windows, two chat windows, no focus: pass" "pass" \
  "$(verdict 1)"
expect "one mail window is a failure" "fail" "$(verdict 1 MAIL_WINDOWS=1)"
expect "a focus request is a failure" "fail" "$(verdict 1 MAIL_FOCUSED=1)"
expect "one chat window is a failure" "fail" "$(verdict 1 CHAT_WINDOWS=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the app window reuse guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
