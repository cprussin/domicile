#!/usr/bin/env bash
# Asserts the kept-key guard's verdict, which end each failure blames, and what
# its preferences helper leaves in a profile.
#
# Runs the verdict block from `guard-extension-kept-key.sh` itself, as
# `test-extension-commands-guard.sh` does.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-kept-key.sh"
PREFS="$SCRIPTS/guard-extension-kept-key-prefs.py"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
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

expect "a key taken back passes" "pass" "$(verdict "claim 1 took 1")"
expect "a sharp control passes" "pass" "$(verdict "control 1 took 1")"
expect "a key not taken back blames OnExtensionLoaded" "yes" \
  "$(says "claim 1 took 0" "OnExtensionLoaded")"
expect "a cleared key that came back blames CanAutoAssign" "yes" \
  "$(says "control 1 took 0" "CanAutoAssign")"
expect "no keys at install blames the first start" "yes" \
  "$(says "claim 0 took 1" "first start")"
expect "no preferences blames the stop" "yes" \
  "$(says "claim 1 unwritten 0" "SIGTERM")"
expect "no binding written blames the stop" "yes" \
  "$(says "claim 1 none 1" "did not write")"
expect "an unknown leg fails" "fail" "$(verdict "")"

# The helper, on a profile shaped as Chrome writes one.
readonly ID="cobncddhpfhclknjbapgflpohofecjhg"
profile() { # $1 the directory
  mkdir -p "$1/Default"
  cat >"$1/Default/Preferences" <<JSON
{"extensions": {
  "commands": {
    "linux:Ctrl+Shift+L": {"extension": "$ID", "command_name": "fill", "global": false},
    "linux:Ctrl+Shift+U": {"extension": "$ID", "command_name": "_execute_action", "global": false}
  },
  "settings": {"$ID": {"commands": {
    "fill": {"suggested_key": "Ctrl+Shift+L", "was_assigned": true},
    "_execute_action": {"suggested_key": "Ctrl+Shift+U", "was_assigned": true}
  }}}
}}
JSON
}
read_pref() { # $1 the directory, $2 a Python expression over `p`
  python3 -c "import json,sys; p=json.load(open(sys.argv[1])); print($2)" \
    "$1/Default/Preferences"
}

profile "$WORK/kept"
expect "the helper takes a bound key" "took" \
  "$(python3 "$PREFS" --profile "$WORK/kept" --id "$ID" --command fill)"
expect "and leaves no binding for it" "False" \
  "$(read_pref "$WORK/kept" "'linux:Ctrl+Shift+L' in p['extensions']['commands']")"
expect "and leaves the action's" "True" \
  "$(read_pref "$WORK/kept" "'linux:Ctrl+Shift+U' in p['extensions']['commands']")"
expect "and no was_assigned, as Chrome leaves a key it kept" "False" \
  "$(read_pref "$WORK/kept" "'was_assigned' in p['extensions']['settings']['$ID']['commands']['fill']")"
expect "a second pass finds no binding" "none" \
  "$(python3 "$PREFS" --profile "$WORK/kept" --id "$ID" --command fill)"

profile "$WORK/cleared"
python3 "$PREFS" --profile "$WORK/cleared" --id "$ID" --command fill --cleared >/dev/null
expect "--cleared keeps was_assigned, as Chrome leaves a key the person cleared" "True" \
  "$(read_pref "$WORK/cleared" "p['extensions']['settings']['$ID']['commands']['fill']['was_assigned']")"

mkdir -p "$WORK/empty"
expect "a profile with no preferences is unwritten" "unwritten" \
  "$(python3 "$PREFS" --profile "$WORK/empty" --id "$ID" --command fill)"

read_from() { # $1 the readonly's name, $2 the guard
  sed -n "s/^readonly $1=\"\(.*\)\"\$/\1/p" "$2"
}
for name in ID FILL ACTION; do
  expect "the guard's $name is the commands guard's" \
    "$(read_from "$name" "$SCRIPTS/guard-extension-commands.sh")" \
    "$(read_from "$name" "$GUARD")"
done
expect "this test's id is the guard's" "$ID" "$(read_from ID "$GUARD")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the kept-key guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
