#!/usr/bin/env bash
# Asserts the extension-page guard's verdict: which answers pass, and which end
# each failure blames.
#
# Runs the verdict block from `guard-extension-page.sh` itself, as
# `test-extension-commands-guard.sh` does, and holds the guard's id, keys and
# item to the fixture it shares with that guard.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-page.sh"
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

expect "every step done passes" "pass" \
  "$(verdict "page 1 1 0 1 0 1 1 1 2 1 1 1 1")"
expect "no list sent blames the stand-in's connection" "yes" \
  "$(says "page 0 0 0 0 0 0 0 0 0 0 0 0 1" "never sent")"
expect "a page not loaded is named" "yes" \
  "$(says "page 1 0 0 0 0 0 0 0 0 0 0 0 1" "never loaded")"
expect "a key the page got is the failure" "yes" \
  "$(says "page 1 1 1 0 0 1 1 1 1 1 1 1 1" "THE DEFAULT PAGE GOT")"
expect "a command not run blames RunCommandIn" "yes" \
  "$(says "page 1 1 0 0 0 1 1 1 1 1 1 1 1" "RunCommandIn")"
expect "a key the work page got is the failure" "yes" \
  "$(says "page 1 1 0 1 1 0 1 1 1 1 1 1 1" "the work page got")"
expect "a command run in another profile is named" "yes" \
  "$(says "page 1 1 0 1 0 0 1 1 2 1 1 1 1" "the default profile's copy")"
expect "a private key the page never got is the failure" "yes" \
  "$(says "page 1 1 0 1 0 1 0 1 2 1 1 1 1" "never got the key")"
expect "a command not named to a listening shell is the failure" "yes" \
  "$(says "page 1 1 0 1 0 1 1 0 3 1 1 1 1" "never named the command")"
expect "a command run under a listening shell is the failure" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 3 1 1 1 1" "the shell listened for")"
expect "another number of runs fails" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 4 1 1 1 1" "another number")"
expect "no item blames PageMenuOf" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 2 0 0 0 1" "PageMenuOf")"
expect "an item not run blames RunContextMenuExtensionItem" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 2 1 0 0 1" "runExtensionItem()")"
expect "a stale item run is the failure" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 2 1 1 0 1" "A PAGE THAT IS GONE")"
expect "an action's key with no popup is the failure" "yes" \
  "$(says "page 1 1 0 1 0 1 1 1 2 1 1 1 0" "RunCommandIn's action")"
expect "the sharp control passes" "pass" "$(verdict "control 1 1 1 0 1")"
expect "a control whose page heard no key fails" "fail" \
  "$(verdict "control 1 1 0 0 1")"
expect "a control whose key ran a command fails" "fail" \
  "$(verdict "control 1 1 1 1 1")"
expect "a control whose menu had items fails" "fail" \
  "$(verdict "control 1 1 1 0 0")"
expect "a control whose pages never loaded fails" "fail" \
  "$(verdict "control 1 0 0 0 0")"
expect "an unknown leg fails" "fail" "$(verdict "")"

read_from() { # $1 the readonly's name, $2 the guard
  sed -n "s/^readonly $1=\"\(.*\)\"\$/\1/p" "$2"
}
for name in ID FILL ACTION; do
  expect "the guard's $name is the commands guard's" \
    "$(read_from "$name" "$SCRIPTS/guard-extension-commands.sh")" \
    "$(read_from "$name" "$GUARD")"
done
expect "the fixture has the guard's page item" "yes" \
  "$(grep -qF "title: \"$(read_from ITEM "$GUARD")\"" "$FIXTURE/background.js" && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-page guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
