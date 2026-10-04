#!/usr/bin/env bash
# Tests the verdict block of `guard-shell-shortcuts.sh`: which side it blames
# and what it passes.
#
# The guard checks for an absence (no reload, navigation, resize or closed
# window), which a run that pressed nothing also shows. The order of the
# checks tells them apart. The block is read from the real script.
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

# A passing run; each case changes one value.
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
# Ctrl+W and Ctrl+Shift+Q are pressed last, so a browser they closed also
# leaves chords unheard. Blame the chord, not the harness.
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
echo "what counts as moved — read off the engine log by the guard's own line"
# A headless window resizes its viewport once while the shell loads, before
# any key. Only events after the first key count.
MOVED_LINE="$(grep -E '^MOVED=' "$GUARD")"
[ -n "$MOVED_LINE" ] || {
  echo "no MOVED= line in $GUARD — its reading moved. Fix this test with it." >&2
  exit 1
}
moved() { # engine log lines, one per argument
  (
    ENGINE_LOG="$(mktemp)"
    printf '%s\n' "$@" >"$ENGINE_LOG"
    eval "$MOVED_LINE"
    rm -f "$ENGINE_LOG"
    echo "$MOVED"
  )
}
expect "a resize before the first key is the shell settling, not a key" "0" \
  "$(moved '"GUARD loaded"' '"GUARD resized"' '"GUARD keydown code=Equal"')"
expect "a resize after a key is the key's" "1" \
  "$(moved '"GUARD loaded"' '"GUARD keydown code=Equal"' '"GUARD resized"')"
expect "a popstate after a key is the key's" "1" \
  "$(moved '"GUARD loaded"' '"GUARD keydown code=ArrowLeft"' '"GUARD popstate"')"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the shell-shortcuts guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
