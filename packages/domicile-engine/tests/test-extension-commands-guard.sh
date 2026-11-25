#!/usr/bin/env bash
# Asserts the extension-commands guard's verdict: which answers pass, and which
# end each failure blames.
#
# Runs the verdict block from `guard-extension-commands.sh` itself, as
# `test-extension-menu-guard.sh` does, and holds the guard's id and keys to the
# fixture.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-commands.sh"
FIXTURE="$SCRIPTS/guard-extension-commands-extension"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
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

# Prints pass or fail, not the message, which may be reworded.
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

# Whether the failure message contains `$2`; the end it blames matters.
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

expect "every step done passes" "pass" "$(verdict "commands 1 1 1 1 1 1 1 1")"
expect "no list sent blames the stand-in's connection" "yes" \
  "$(says "commands 0 0 0 0 0 0 0 0" "never sent")"
expect "no list heard blames the binding" "yes" \
  "$(says "commands 1 0 0 0 0 0 0 0" "did not bind")"
expect "wrong keys blame CommandsOf" "yes" \
  "$(says "commands 1 1 0 0 0 0 0 0" "CommandsOf")"
expect "a command not heard blames RunCommand" "yes" \
  "$(says "commands 1 1 1 0 0 0 0 0" "RunCommand")"
expect "no menu blames ActionMenuOf" "yes" \
  "$(says "commands 1 1 1 1 0 0 0 0" "ActionMenuOf")"
expect "a click not heard blames RunActionMenuItem" "yes" \
  "$(says "commands 1 1 1 1 1 0 0 0" "RunActionMenuItem")"
expect "a reserved key still the fixture's is a failure" "yes" \
  "$(says "commands 1 1 1 1 1 1 1 0" "IsReservedByShell")"
expect "no popup is a failure" "fail" "$(verdict "commands 1 1 1 1 1 1 0 0")"
expect "the sharp control passes" "pass" "$(verdict "control 1 1 0 1 0")"
expect "a control that listed the fixture fails" "fail" \
  "$(verdict "control 1 1 1 1 0")"
expect "a control with a menu fails" "fail" "$(verdict "control 1 1 0 0 0")"
expect "a control that ran a command fails" "fail" \
  "$(verdict "control 1 1 0 1 1")"
expect "a control that heard no list fails" "fail" \
  "$(verdict "control 1 0 0 0 0")"
expect "an unknown leg fails" "fail" "$(verdict "")"

read_from() { # $1 the readonly's name, $2 the guard
  sed -n "s/^readonly $1=\"\(.*\)\"\$/\1/p" "$2"
}
key_of() { # $1 the manifest
  sed -n 's/^  "key": "\(.*\)",$/\1/p' "$1"
}
expect "the guard's id is the tray guard's" \
  "$(read_from ID "$SCRIPTS/guard-extension-tray.sh")" "$(read_from ID "$GUARD")"
expect "and the fixture's key is the tray fixture's, which makes it so" \
  "$(key_of "$SCRIPTS/guard-extension-tray-extension/manifest.json")" \
  "$(key_of "$FIXTURE/manifest.json")"
expect "the fixture suggests the guard's keys" "yes" \
  "$(grep -qF "\"$(read_from FILL "$GUARD")\"" "$FIXTURE/manifest.json" &&
    grep -qF "\"$(read_from ACTION "$GUARD")\"" "$FIXTURE/manifest.json" && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-commands guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
