#!/usr/bin/env bash
# Tests how `guard-webview-hidden.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - A page that says visible on attach and hidden after is hidden: only its
#     last state before the box is shown counts.
#   - A page shown and then occluded at once, as in a headless window with an
#     empty viewport, was not visible when the box was hidden again.
#   - A page still visible when the box is shown fails, and names the frame's
#     visibility.
#   - The control passes only on a visible page, so the claim's hidden page is
#     the box's doing.
#   - A shown page that blinks hidden fails: watched from showing in the
#     claim, from the start in the control.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-hidden.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^STATES="\$\(awk/,/"\$ENGINE_LOG" 2>\/dev\/null\)"$/' "$GUARD")"
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

# Writes a log with one console line per argument, as the engine logs them.
log() { # lines...
  for line in "$@"; do
    printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: http://127.0.0.1:9/page (7)\n' "$line"
  done >"$WORK/engine.log"
}

reads() { # lines...
  log "$@"
  (
    ENGINE_LOG="$WORK/engine.log"
    HIDE="${HIDE:-1}"
    eval "$READING"
    echo "$STATES"
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
expect "the state at showing, whether visible at hiding, the last state" \
  "hidden 1 hidden 1" \
  "$(reads state=hidden attached state=visible state=hidden "showing in 1024x768" \
    state=visible hiding state=hidden)"
expect "a page shown and then occluded at once was not visible at hiding" \
  "hidden 0 hidden 0" \
  "$(reads state=hidden attached state=visible state=hidden "showing in 0x0" \
    state=visible state=hidden hiding)"
expect "a page that never changes keeps its one state throughout" \
  "visible 1 visible 1" "$(reads state=visible showing hiding)"
expect "a page that says nothing after hiding keeps its state" \
  "hidden 1 visible 1" "$(reads state=hidden showing state=visible hiding)"
expect "a log with no states reads none" "none 0 none 1" "$(reads showing hiding)"
expect "a log with no steps reads the last state before showing" \
  "hidden 0 none 1" "$(reads state=visible state=hidden)"
expect "a blink of hidden after showing is not steady" \
  "hidden 1 hidden 0" \
  "$(reads state=hidden attached showing state=visible state=hidden \
    state=visible hiding state=hidden)"
expect "a blink at attach, before the claim shows the box, is not watched" \
  "hidden 1 hidden 1" \
  "$(reads state=hidden state=visible attached state=hidden showing \
    state=visible hiding state=hidden)"
expect "the control watches from the start, and sees a blink at attach" \
  "visible 1 hidden 0" \
  "$(HIDE=0 reads state=hidden state=visible attached state=hidden \
    state=visible showing hiding state=hidden)"
expect "the control's page loaded hidden, then shown, is steady" \
  "visible 1 hidden 1" \
  "$(HIDE=0 reads state=hidden state=visible attached showing hiding \
    state=hidden)"

# MEASURED is "<mode> <shell> <page> <steps> <before> <shown> <after>
# <steady>".
echo
echo "the claim — a window in a box that starts hidden"
expect "hidden, then visible, then hidden is the pass" "pass" \
  "$(verdict "hidden 1 1 1 hidden 1 hidden 1")"
expect "visible while not rendered is a failure" "fail" \
  "$(verdict "hidden 1 1 1 visible 1 hidden 1")"
expect "and names the frame's visibility" "yes" \
  "$(says "hidden 1 1 1 visible 1 hidden 1" "OnRenderFrameProxyVisibilityChanged")"
expect "never visible once shown is a failure" "fail" \
  "$(verdict "hidden 1 1 1 hidden 0 hidden 1")"
expect "and names occlusion, the headless viewport's failure" "yes" \
  "$(says "hidden 1 1 1 hidden 0 hidden 1" "WasOccluded")"
expect "still visible once hidden again is a failure" "fail" \
  "$(verdict "hidden 1 1 1 hidden 1 visible 1")"
expect "no state after hiding is a failure" "fail" \
  "$(verdict "hidden 1 1 1 hidden 1 none 1")"
expect "steps that never ran are a failure" "fail" \
  "$(verdict "hidden 1 1 0 hidden 0 none 1")"
expect "and blame the attach" "yes" \
  "$(says "hidden 1 1 0 hidden 0 none 1" "AttachWindowTo")"
expect "a page that never loaded is a failure" "fail" \
  "$(verdict "hidden 1 0 0 none 0 none 1")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "hidden 0 0 0 none 0 none 1")"
expect "a page that never said its state is a failure" "fail" \
  "$(verdict "hidden 1 1 1 none 1 hidden 1")"
expect "a blink in the claim's shown box is a failure" "fail" \
  "$(verdict "hidden 1 1 1 hidden 1 hidden 0")"
expect "and names the frame's visibility" "yes" \
  "$(says "hidden 1 1 1 hidden 1 hidden 0" "RemoteFrameView::VisibilityChanged")"

echo
echo "the control — the same window in a box shown from the start"
expect "visible before showing is the control's pass" "pass" \
  "$(verdict "shown 1 1 1 visible 0 hidden 1")"
expect "a blink in the control is a failure too" "fail" \
  "$(verdict "shown 1 1 1 visible 0 hidden 0")"
expect "hidden before showing is the control's failure" "fail" \
  "$(verdict "shown 1 1 1 hidden 1 hidden 1")"
expect "and says the claim then means nothing" "yes" \
  "$(says "shown 1 1 1 hidden 1 hidden 1" "says nothing")"
expect "a page that never loaded is the control's failure too" "fail" \
  "$(verdict "shown 1 0 0 none 0 none 1")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the hidden-webview guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
