#!/usr/bin/env bash
# Tests the verdict of `guard-webview-window-open.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: a window that never opened only means something once
# a press reached the page. Key cases:
#
#   - A browser that made no window blames patch 0115: content refused it.
#   - A window with no opener or name fails: the page got a window it cannot
#     script.
#   - In the control, any window report fails: the press was on the part of
#     the page that opens nothing.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-window-open.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the column-zero `fi` that ends the decision.
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

# Runs the block with every reading at its passing value; each case overrides
# one. Prints "pass", "fail" or "neither", then the failure on the next line.
judge() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_MADE=1
    SAW_HANDLE=1
    SAW_LISTED=1
    SAW_CHILD=1
    SAW_MESSAGE=1
    SAW_ANY=1
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
    echo "$FAILURE"
  )
}

verdict() { judge "$@" | head -1; }

blames() { # $1 word, then the args judge takes
  local word="$1"
  shift
  case "$(judge "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# The control presses the plain half, so it opens no window.
control() {
  verdict 1 SAW_MADE=0 SAW_HANDLE=0 SAW_LISTED=0 SAW_CHILD=0 SAW_MESSAGE=0 \
    SAW_ANY=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "no press in the page is a failure" "fail" "$(verdict 0 SAW_PRESS=0)"
expect "no press in the page is the control's failure too" "fail" \
  "$(control SAW_PRESS=0)"

echo
echo "the positive run — the open button"
expect "a window opened and scripted is the pass" "pass" "$(verdict 0)"
expect "a browser that made no window blames patch 0115" "yes" \
  "$(blames "patch 0115" 0 SAW_MADE=0)"
expect "a null handle is a failure" "fail" "$(verdict 0 SAW_HANDLE=0)"
expect "an unlisted window blames AddNewContents" "yes" \
  "$(blames "AddNewContents" 0 SAW_LISTED=0)"
expect "a window without its opener or name is a failure" "fail" \
  "$(verdict 0 SAW_CHILD=0)"
expect "an opener that never heard the window is a failure" "fail" \
  "$(verdict 0 SAW_MESSAGE=0)"

echo
echo "the control run — a press on the half that opens nothing"
expect "opening nothing is the pass" "pass" "$(control)"
expect "any window report is the control's failure" "fail" \
  "$(control SAW_ANY=1)"

echo
echo "the wait before the verdict"
# The positive run's wait, from the real guard. The shell lists the window
# when `browserwindowschanged` reaches it, which can be after the opener hears
# from the window; a verdict read before then blames AddNewContents for nothing.
WAIT_FOR="$(awk '/^wait_for_line\(\) \{/,/^\}$/' "$GUARD")"
PRESS="$(awk '/^# 5\. /,/^fi$/' "$GUARD")"
[ -n "$WAIT_FOR" ] && [ -n "$PRESS" ] || {
  echo "no wait or press block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}
listed_after_wait() { # $1 seconds until the shell lists the window
  (
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    ENGINE_LOG="$WORK/engine.log"
    INPUT_LOG="$WORK/input.log"
    SITE="http://127.0.0.1:1"
    NEGATIVE=0 TRIES=40 WINDOW_X=0 BUTTON_Y=0
    click() { :; }
    echo '"GUARD page-message hello"' >"$ENGINE_LOG"
    (sleep "$1" && echo "\"GUARD new-window url=$SITE/child\"" >>"$ENGINE_LOG") &
    eval "$WAIT_FOR"
    eval "$PRESS" 2>/dev/null
    if grep -qF "GUARD new-window url=$SITE/child" "$ENGINE_LOG"; then
      echo listed
    else
      echo unlisted
    fi
    wait
  )
}
expect "the guard waits for the shell to list the window" "listed" \
  "$(listed_after_wait 1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the window.open guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
