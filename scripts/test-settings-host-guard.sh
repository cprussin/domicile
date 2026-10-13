#!/usr/bin/env bash
# Which end the Settings host guard blames, and which runs it calls a pass.
#
# The unit is the verdict block in `guard-settings-host.sh`, run out of the
# real script rather than copied, so a rewrite that moves it fails here. Also
# holds the guard's app id to the one `domicile` lists the host for.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-settings-host.sh"
APPS="$ROOT/packages/domicile-launch/src/apps.rs"
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

# A positive run in which everything is true; each case changes one reading.
# Prints the verdict, then the failing sentence.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  (
    ID="the-app"
    SAW_WORKER=1
    SAW_REPLY=1
    SAW_FORBIDDEN=0
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

# The control's own shape: refused, and no reply.
control() {
  verdict 1 SAW_REPLY=0 SAW_FORBIDDEN=1 "$@"
}

echo "the app's id"
expect "is the one domicile lists the host for" "yes" \
  "$(grep -qF "chrome-extension://$(sed -n 's/^readonly ID="\(.*\)"$/\1/p' "$GUARD")/settings.html" "$APPS" && echo yes || echo no)"

echo
echo "a run that never got as far as connecting"
expect "a worker that never ran is a failure" "fail" "$(verdict 0 SAW_WORKER=0)"
expect "and blames the harness" "yes" "$(blames "harness" 0 SAW_WORKER=0)"
expect "in the control too" "fail" "$(control SAW_WORKER=0)"

echo
echo "the positive run"
expect "the config read through the host is the pass" "pass" "$(verdict 0)"
expect "a refused connection is a failure" "fail" \
  "$(verdict 0 SAW_REPLY=0 SAW_FORBIDDEN=1)"
expect "and names allowed_origins" "yes" \
  "$(blames "allowed_origins" 0 SAW_REPLY=0 SAW_FORBIDDEN=1)"
expect "no reply is a failure" "fail" "$(verdict 0 SAW_REPLY=0)"
expect "and names the host" "yes" "$(blames "domicile-settings-host" 0 SAW_REPLY=0)"

echo
echo "the control run -- an extension without the app's key"
expect "a refusal and no reply is the pass" "pass" "$(control)"
expect "a reply anyway is the control's failure" "fail" "$(control SAW_REPLY=1)"
expect "no refusal is a failure" "fail" "$(control SAW_FORBIDDEN=0)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the Settings host guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
