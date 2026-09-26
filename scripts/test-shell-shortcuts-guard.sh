#!/usr/bin/env bash
# Which end the shell-shortcuts guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-shell-shortcuts.sh`. The claim is an
# absence -- no reload, no navigation, no resize, no closed window -- which is
# also what a run that pressed nothing looks like, so the order of the gates is
# what separates the two. Run out of the real script rather than copied.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell-shortcuts.sh"
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

# A run in which everything the guard wants is true; each case changes one.
readings() { # $1 NEGATIVE, then NAME=value overrides
  CHORDS=(a b c)
  SAW_LOADED=1
  HEARD=3
  HEARD_ALL=1
  PRESSED_AFTER=1
  LOADS=1
  MOVED=0
  NEGATIVE="$1"
  shift
  for override in "$@"; do
    eval "$override"
  done
}

verdict() {
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
  case "$(readings "$@"; eval "$BLOCK"; echo "$FAILURE")" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "no shell is a failure" "fail" "$(verdict 0 SAW_LOADED=0 LOADS=0)"
expect "no shell is a failure in the control too" "fail" \
  "$(verdict 1 SAW_LOADED=0 LOADS=0)"
expect "chords the shell never heard are a failure" "fail" \
  "$(verdict 0 HEARD=1 HEARD_ALL=0)"
expect "chords the shell never heard blame the harness" "yes" \
  "$(blames "harness" 0 HEARD=1 HEARD_ALL=0)"

echo
echo "the run — Chrome's shortcuts at a shell that handles none"
expect "a shell left alone is the pass" "pass" "$(verdict 0)"
expect "a reload is a failure" "fail" "$(verdict 0 LOADS=2)"
expect "a reload names Ctrl+R" "yes" "$(blames "Ctrl+R" 0 LOADS=2)"
expect "a popstate or resize is a failure" "fail" "$(verdict 0 MOVED=1)"
expect "a popstate or resize names Alt+Left" "yes" "$(blames "Alt+Left" 0 MOVED=1)"
expect "a browser gone after the chords is a failure" "fail" \
  "$(verdict 0 PRESSED_AFTER=0)"
# BEFORE THE HEARING: Ctrl+W and Ctrl+Shift+Q are pressed last, so a browser
# they took leaves chords unheard too, and that is not the harness.
expect "a browser gone names Ctrl+W before the harness" "yes" \
  "$(blames "Ctrl+W" 0 PRESSED_AFTER=0 HEARD=2 HEARD_ALL=0)"

echo
echo "the control — the browser reloads the shell itself"
expect "a reload the control made, read, is the pass" "pass" \
  "$(verdict 1 LOADS=2 HEARD=0 HEARD_ALL=0)"
expect "a control that read one load is a failure" "fail" \
  "$(verdict 1 HEARD=0 HEARD_ALL=0)"
expect "a control whose browser stopped answering is a failure" "fail" \
  "$(verdict 1 LOADS=2 PRESSED_AFTER=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the shell-shortcuts guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
