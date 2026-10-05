#!/usr/bin/env bash
# Tests the verdict of `guard-webview-new-window.sh`: which readings pass and
# which component a failure blames.
#
# The checks are ordered: "the link asked for no window" only means something
# once a press landed on the link. Easy to get backward:
#
#   - In the control, the element asking for a window is the failure, and so
#     is a press that followed no link.
#   - In the positive run, a press on the ordinary link blames geometry, not
#     the defect.
#   - A request with no page in the new window fails: a listed window is not
#     a window on screen.
#   - When nothing was requested, a browser log line decides which process is
#     blamed.
#
# Runs the verdict block from the real guard, so moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-new-window.sh"
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

# A run where every reading has its passing value; each case overrides one by
# name, which reads better than positional arguments.
#
# `SAW_STAYED=0` because the positive run clicks the target=_blank link; the
# page staying put is the control's passing reading.
verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_ASKED=1
    SAW_ADDRESS=1
    SAW_SECOND=1
    SAW_OPENED=1
    SAW_STAYED=0
    SAW_REFUSED=1
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
    SAW_PAGE=1
    SAW_CHROME=1
    SAW_GUEST=1
    SAW_ASKED=1
    SAW_ADDRESS=1
    SAW_SECOND=1
    SAW_OPENED=1
    SAW_STAYED=0
    SAW_REFUSED=1
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

# The control's readings: it clicks the ordinary link, so it requests no
# window and its page navigates.
control() { # the overrides a case adds
  verdict 1 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 SAW_STAYED=1 \
    SAW_REFUSED=0 "$@"
}

controlBlames() { # $1 word, then overrides
  blames "$1" 1 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0 "${@:2}"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_SHELL=0)"
# The control must fail too: with no page, no request is also what a broken
# harness looks like.
expect "a shell that never ran is a failure in the control run" "fail" \
  "$(control SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no press in the shell's document is a failure" "fail" \
  "$(verdict 0 SAW_CHROME=0)"
expect "no press in the shell's document is a failure in the control too" \
  "fail" "$(control SAW_CHROME=0)"
expect "no press in the shell's document blames the harness" "yes" \
  "$(blames "harness" 0 SAW_CHROME=0)"
# Unlike the click guard's control, both runs click a link in the page, so an
# empty window fails both.
expect "an empty window is a failure in the positive run" "fail" \
  "$(verdict 0 SAW_PAGE=0)"
expect "an empty window is a failure in the control run" "fail" \
  "$(control SAW_PAGE=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "a press that never reached the guest is a failure" "fail" \
  "$(verdict 0 SAW_GUEST=0)"
expect "a press that never reached the guest blames the hit test" "yes" \
  "$(blames "hit-tested" 0 SAW_GUEST=0)"

echo
echo "the positive run — a target=_blank link, and the window it must produce"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
# Looks like the defect but is not: the press hit the control's link.
expect "a press on the ordinary link is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0)"
expect "a press on the ordinary link blames the geometry" "yes" \
  "$(blames "geometry" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0 \
    SAW_STAYED=1 SAW_REFUSED=0)"
# The browser's log line says which process to look in. With it, the renderer
# asked and the refusal never reached the page. Without it, nothing asked, so
# no fix in the page's layer applies.
expect "an ask the browser refused and never reported is a failure" "fail" \
  "$(verdict 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 SAW_OPENED=0)"
expect "an ask the browser refused and never reported blames the report" \
  "yes" "$(blames "THE PAGE WAS NOT TOLD" 0 SAW_ASKED=0 SAW_ADDRESS=0 \
    SAW_SECOND=0 SAW_OPENED=0)"
expect "no ask at the browser at all blames the renderer's request" "yes" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 \
    SAW_OPENED=0 SAW_REFUSED=0)"
expect "no ask at the browser at all does not blame the report" "no" \
  "$(blames "THE PAGE WAS NOT TOLD" 0 SAW_ASKED=0 SAW_ADDRESS=0 \
    SAW_SECOND=0 SAW_OPENED=0 SAW_REFUSED=0)"
# The wrong-link arm is checked first: a press on the ordinary link also lacks
# both readings above.
expect "the wrong link outranks the process the ask stopped in" "no" \
  "$(blames "NEVER ASKED" 0 SAW_ASKED=0 SAW_ADDRESS=0 SAW_SECOND=0 \
    SAW_OPENED=0 SAW_STAYED=1 SAW_REFUSED=0)"

echo
echo "the address, and the window the list is only half of"
expect "a window at the wrong address is a failure" "fail" \
  "$(verdict 0 SAW_ADDRESS=0)"
expect "a window at the wrong address says so" "yes" \
  "$(blames "WRONG ADDRESS" 0 SAW_ADDRESS=0)"
expect "a shell that was told and opened nothing is a failure" "fail" \
  "$(verdict 0 SAW_SECOND=0 SAW_OPENED=0)"
expect "a shell that was told and opened nothing blames this guard's page" \
  "yes" "$(blames "guard-webview-new-window.js" 0 SAW_SECOND=0 SAW_OPENED=0)"
# The case this guard exists for: the window is listed, but the user sees an
# empty window.
expect "a second view with no page in it is a failure" "fail" \
  "$(verdict 0 SAW_OPENED=0)"
expect "a second view with no page in it names the window's page" "yes" \
  "$(blames "NONE ON THE SCREEN" 0 SAW_OPENED=0)"

echo
echo "the control run — an ordinary link, which must ask for nothing"
expect "asking for nothing and navigating is the pass" "pass" "$(control)"
expect "an ask is the failure" "fail" "$(control SAW_ASKED=1)"
expect "an ask says the positive run would be measuring the element" "yes" \
  "$(controlBlames "any click" SAW_ASKED=1)"
# A press that followed no link says nothing about links.
expect "a press that followed no link is the control's failure" "fail" \
  "$(control SAW_STAYED=0)"
expect "a press that followed no link blames the geometry" "yes" \
  "$(controlBlames "geometry" SAW_STAYED=0)"
# The control is not about the second window.
expect "the second window is not the control's business" "pass" \
  "$(control SAW_SECOND=0 SAW_OPENED=0 SAW_ADDRESS=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the new-window guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
