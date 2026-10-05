#!/usr/bin/env bash
# Tests the verdict of `guard-webview-routed-link.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: "the browser was never asked" only means something
# once a press landed on a link. Key cases:
#
#   - The shell asked for a window without the engine's routed-link line
#     fails. `CreateCustomWebContents` (target="_blank") and `OpenURLFromTab`
#     (this path) both open a browser window, so only the engine's line shows
#     the delegate under test ran.
#   - The run and control press the same point on the same link with
#     different buttons. A middle press that navigated in place arrived as a
#     left press; that blames the driver or hit test, not the delegate.
#   - In the control, a request is the failure, and so is a press that
#     followed no link.
#   - Whether the browser was asked separates a gesture that never reached
#     the delegate from a delegate that dropped it.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-routed-link.sh"
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

# A run where every reading has its passing value; each case overrides one.
# `SAW_MOVED=0` because a middle press must not navigate the guest; moving is
# the control's passing reading.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_ASKED=1
    SAW_MOVED=0
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

# The failure message, for cases that check which component it blames. Tests
# match a keyword, not the whole sentence.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_ROUTED=1
    SAW_ASKED=1
    SAW_MOVED=0
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

# The control's readings: a left press on the same link navigates in place
# and requests nothing.
control() { # the overrides a case adds
  verdict 1 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1 "$@"
}

controlBlames() { # $1 word, then overrides
  blames "$1" 1 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1 "${@:2}"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran is a failure in the control run" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
expect "an empty window is a failure" "fail" "$(verdict 0 SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press that never reached the page is a failure" "fail" \
  "$(verdict 0 SAW_PRESS=0)"
expect "a press that never reached the page blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_PRESS=0)"

echo
echo "the positive run — a middle click on an ordinary link"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# The key arm: with no routed-link line, the request came from
# CreateCustomWebContents and the delegate under test never ran.
expect "an ask with no routed line is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0)"
expect "an ask with no routed line blames the other path" "yes" \
  "$(blames "CreateCustomWebContents" 0 SAW_ROUTED=0)"
expect "an ask with no routed line is not read as a pass" "no" \
  "$(blames "the delegate took it" 0 SAW_ROUTED=0)"
# Looks like the defect but is not: the press arrived as a left press.
expect "a guest that moved in place is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
expect "a guest that moved in place blames the button" "yes" \
  "$(blames "button" 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
expect "a guest that moved in place does not blame the other path" "no" \
  "$(blames "CreateCustomWebContents" 0 SAW_ROUTED=0 SAW_ASKED=0 SAW_MOVED=1)"
# A click that did nothing has two causes in two layers.
expect "nothing at all is a failure" "fail" \
  "$(verdict 0 SAW_ROUTED=0 SAW_ASKED=0)"
expect "nothing at all blames the routing" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_ROUTED=0 SAW_ASKED=0)"
expect "a routed line with no ask is a failure" "fail" "$(verdict 0 SAW_ASKED=0)"
expect "a routed line with no ask blames the report" "yes" \
  "$(blames "TOOK IT AND SAID NOTHING" 0 SAW_ASKED=0)"
expect "a routed line with no ask does not blame the routing" "no" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0)"
# Requesting a window and also navigating performs the gesture twice.
expect "asking and moving both is a failure" "fail" "$(verdict 0 SAW_MOVED=1)"
expect "asking and moving both blames the double action" "yes" \
  "$(blames "TWICE" 0 SAW_MOVED=1)"

echo
echo "the control run — the same link, pressed with the left button"
expect "following the link in place is the pass" "pass" "$(control)"
expect "an ask is the control's failure" "fail" "$(control SAW_ASKED=1)"
expect "an ask says the positive run measures nothing" "yes" \
  "$(controlBlames "any press" SAW_ASKED=1)"
# The engine's line in the control fails too: a left click must not reach
# this delegate.
expect "a routed line with no ask is the control's failure" "fail" \
  "$(control SAW_ROUTED=1)"
expect "a press that followed no link is the control's failure" "fail" \
  "$(control SAW_MOVED=0)"
expect "a press that followed no link blames the geometry" "yes" \
  "$(controlBlames "geometry" SAW_MOVED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the routed-link guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
