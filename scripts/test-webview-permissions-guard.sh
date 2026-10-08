#!/usr/bin/env bash
# Which end the permissions guard blames, and which answers it calls a pass.
#
# The unit is the verdict block in `guard-webview-permissions.sh`: the `if`
# chain that turns eight readings and the run's mode into a pass or one
# sentence naming an end. The readings depend on each other -- an answer means
# nothing before the shell was asked -- so the chain is ordered.
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here instead of leaving this passing against a version nobody
# ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-permissions.sh"
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
    SAW_PAGE=1
    SAW_BROWSER=1
    SAW_ASKED=1
    SAW_ANSWERED=1
    SAW_GRANTED=1
    SAW_REFUSED=0
    SAW_STORED=1
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

# The control's own shape: the shell denies, the page is refused.
control() {
  verdict 1 SAW_GRANTED=0 SAW_REFUSED=1 "$@"
}

echo "a run that never got as far as measuring anything"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "an empty window names the guest" "yes" \
  "$(blames "the guest" 0 SAW_PAGE=0)"
expect "no prompt blames the browser's path" "yes" \
  "$(blames "AttachPermissionPrompts" 0 SAW_BROWSER=0)"
expect "a prompt the shell never heard blames the event's path" "yes" \
  "$(blames "PermissionRequested" 0 SAW_ASKED=0)"
expect "an answer that threw is a failure" "fail" \
  "$(verdict 0 SAW_ANSWERED=0)"
expect "a shell never asked fails the control too" "fail" \
  "$(control SAW_ASKED=0)"

echo
echo "the positive run"
expect "everything arriving is the pass" "pass" "$(verdict 0)"
expect "an allow the page was refused is a failure" "fail" \
  "$(verdict 0 SAW_GRANTED=0 SAW_REFUSED=1)"
expect "and blames the answer's way back" "yes" \
  "$(blames "Decide" 0 SAW_GRANTED=0 SAW_REFUSED=1)"
expect "a page that heard nothing is a failure" "fail" \
  "$(verdict 0 SAW_GRANTED=0)"
expect "a grant never reported as stored is a failure" "fail" \
  "$(verdict 0 SAW_STORED=0)"
expect "and blames the settings report" "yes" \
  "$(blames "SitePermissionsChanged" 0 SAW_STORED=0)"

echo
echo "the control run -- the shell denies"
expect "a refused page and a blocked site is the pass" "pass" "$(control)"
expect "a camera handed over anyway is the control's failure" "fail" \
  "$(control SAW_GRANTED=1)"
expect "a page that heard nothing fails the control" "fail" \
  "$(control SAW_REFUSED=0)"
expect "a deny never stored fails the control" "fail" \
  "$(control SAW_STORED=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the permissions guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
