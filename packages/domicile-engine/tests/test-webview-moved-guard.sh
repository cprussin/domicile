#!/usr/bin/env bash
# Tests how `guard-webview-moved.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Every move and one attach per move, ending visible, passes.
#   - One attach and no more after three moves fails, and names the element's
#     binding: the frozen window this guard is for.
#   - The control passes only on a page attached once and visible.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-moved.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^READ="\$\(awk/,/"\$ENGINE_LOG" 2>\/dev\/null\)"$/' "$GUARD")"
BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ -n "$READING" ] && [ -n "$BLOCK" ] || {
  echo "no reading or verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

# Writes a log with one line per argument: `attach` as the browser logs an
# attach, anything else as a console line from the shell or the page.
log() { # lines...
  for line in "$@"; do
    case "$line" in
    attach)
      printf '[1:1:INFO:web_view_guest.cc(882)] domicile: attached browser window 1 to a <webview>.\n'
      ;;
    *)
      printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: http://127.0.0.1:9/page (7)\n' "$line"
      ;;
    esac
  done >"$WORK/engine.log"
}

reads() { # $1 moves, then lines...
  local moves="$1"
  shift
  log "$@"
  (
    MOVES="$moves"
    ENGINE_LOG="$WORK/engine.log"
    eval "$READING"
    echo "$READ"
  )
}

verdict() { # $1 MEASURED
  (
    MEASURED="$1"
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

says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "reading the log"
expect "three moves, an attach after each, ending visible" "1 1 visible" \
  "$(reads 3 attach state=visible moved state=hidden attach state=visible \
    moved state=hidden attach state=visible moved state=hidden attach \
    state=visible settled)"
expect "three moves and only the first attach" "1 0 hidden" \
  "$(reads 3 attach state=visible moved state=hidden moved moved settled)"
expect "moves cut short are not every move" "0 1 visible" \
  "$(reads 3 attach attach attach attach state=visible moved settled)"
expect "a shell that never settled did not finish" "0 0 visible" \
  "$(reads 3 attach state=visible moved moved moved)"
expect "no moves, one attach, settled" "1 1 visible" \
  "$(reads 0 attach state=visible settled)"
expect "a page that never said its state reads none" "1 1 none" \
  "$(reads 0 attach settled)"

# MEASURED is "<mode> <shell> <page> <steps> <attaches> <last>".
echo
echo "the claim — a window whose box moves three times"
expect "attached after every move and visible is the pass" "pass" \
  "$(verdict "moved 1 1 1 1 visible")"
expect "not attached after the moves is a failure" "fail" \
  "$(verdict "moved 1 1 1 0 hidden")"
expect "and names the element's binding" "yes" \
  "$(says "moved 1 1 1 0 hidden" "HTMLWebViewElement::RemovedFrom")"
expect "attached but hidden is a failure" "fail" \
  "$(verdict "moved 1 1 1 1 hidden")"
expect "and names the attach's WasShown" "yes" \
  "$(says "moved 1 1 1 1 hidden" "WasShown")"
expect "moves that never ran are a failure" "fail" \
  "$(verdict "moved 1 1 0 0 visible")"
expect "a page that never loaded is a failure" "fail" \
  "$(verdict "moved 1 0 0 0 none")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "moved 0 0 0 0 none")"

echo
echo "the control — the same window in a box that never moves"
expect "attached once and visible is the control's pass" "pass" \
  "$(verdict "still 1 1 1 1 visible")"
expect "hidden is the control's failure" "fail" \
  "$(verdict "still 1 1 1 1 hidden")"
expect "and says the claim then means nothing" "yes" \
  "$(says "still 1 1 1 1 hidden" "says nothing")"
expect "a page that never loaded is the control's failure too" "fail" \
  "$(verdict "still 1 0 0 0 none")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the moved-webview guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
