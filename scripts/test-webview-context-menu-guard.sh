#!/usr/bin/env bash
# Which end the context-menu guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-context-menu.sh`: the `if`
# chain that turns seven readings and the run's mode into a pass or one
# sentence naming an end. The readings depend on each other -- a menu means
# nothing before a press reached the page, DevTools attaching nothing before
# its window was asked for -- so the chain is ordered, and the wrong arm
# answering would send the next person to the wrong layer.
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here instead of leaving this passing against a version nobody
# ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-context-menu.sh"
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

# A run in which everything the claim wants is true; each case changes one
# reading. Prints the verdict, then the failing sentence.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_CHROME=1
    SAW_PAGE=1
    SAW_PRESS=1
    SAW_MENU=1
    SAW_ASKED=1
    SAW_ATTACHED=1
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

verdict() {
  run_block "$@" | head -1
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(run_block "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# The control's own shape: the page cancels its menu, so nothing follows it.
control() {
  verdict 1 SAW_MENU=0 SAW_ASKED=0 SAW_ATTACHED=0 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press the page never heard is a failure" "fail" \
  "$(verdict 0 SAW_PRESS=0)"
expect "a press the page never heard blames the harness" "yes" \
  "$(blames "harness" 0 SAW_PRESS=0)"
expect "a press the page never heard fails the control too" "fail" \
  "$(control SAW_PRESS=0)"

echo
echo "the positive run"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
expect "no menu is a failure" "fail" "$(verdict 0 SAW_MENU=0 SAW_ASKED=0 SAW_ATTACHED=0)"
expect "no menu blames the menu's path" "yes" \
  "$(blames "HandleContextMenu" 0 SAW_MENU=0 SAW_ASKED=0 SAW_ATTACHED=0)"
expect "a menu with no window is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_ATTACHED=0)"
expect "a menu with no window blames inspect" "yes" \
  "$(blames "OpenDevTools" 0 SAW_ASKED=0 SAW_ATTACHED=0)"
expect "a window nothing attached to is a failure" "fail" \
  "$(verdict 0 SAW_ATTACHED=0)"
expect "a window nothing attached to blames the watcher" "yes" \
  "$(blames "DevToolsFrontendWatcher" 0 SAW_ATTACHED=0)"

echo
echo "the control run -- the page cancels its own menu"
expect "the shell hearing nothing is the pass" "pass" "$(control)"
expect "a menu handed over anyway is the control's failure" "fail" \
  "$(control SAW_MENU=1)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the context-menu guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
