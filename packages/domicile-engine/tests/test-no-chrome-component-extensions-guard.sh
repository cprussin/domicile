#!/usr/bin/env bash
# Tests how `guard-no-chrome-component-extensions.sh` reads a profile's
# Preferences and which results it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Preferences that are missing, aren't JSON or have no extensions read as
#     unread, never as none loaded.
#   - The control's extension is found by its directory, not by counting.
#   - The claim passes when the profile loaded neither extension and kept the
#     PDF viewer, and fails on either one, naming the patch.
#   - Without the PDF viewer the claim's none says nothing, and fails.
#   - The control passes only when its own extension is in the Preferences.
#   - A shell that never ran, or Preferences unread, fails in either mode.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-no-chrome-component-extensions.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

IDS="$(grep -E '^(GEMINI|CONTEXTUAL_TASKS|PDF_VIEWER)=' "$GUARD")"
READING="$(awk '/^read_preferences\(\) \{/,/^}$/' "$GUARD")"
BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ "$(printf '%s\n' "$IDS" | grep -c .)" = 3 ] && [ -n "$READING" ] && [ -n "$BLOCK" ] || {
  echo "no ids, reading or verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}
eval "$IDS"
eval "$READING"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/mine" "$WORK/other"

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

# The first line `read_preferences` gives for Preferences holding $1.
reads() { # $1 the Preferences' contents, or `missing`
  local file="$WORK/Preferences"
  rm -f "$file"
  [ "$1" = missing ] || printf '%s' "$1" >"$file"
  read_preferences "$file" "$WORK/mine" 2>/dev/null | sed -n 1p
}
# Preferences whose extensions.settings holds each argument, `id` or
# `id=path`.
settings() { # entries...
  local entries="" entry
  for entry in "$@"; do
    case "$entry" in
    *=*) entry="\"${entry%%=*}\": {\"location\": 8, \"path\": \"${entry#*=}\"}" ;;
    *) entry="\"$entry\": {\"location\": 5, \"path\": \"/x/$entry\"}" ;;
    esac
    entries="${entries:+$entries, }$entry"
  done
  printf '{"extensions": {"settings": {%s}}}' "$entries"
}

# A reading is "<read> <pdf-viewer> <gemini> <contextual-tasks> <own>".
echo "reading the Preferences"
expect "missing reads as unread" "0 0 0 0 0" "$(reads missing)"
expect "not JSON reads as unread" "0 0 0 0 0" "$(reads '{"extensions": ')"
expect "no extensions reads as unread" "0 0 0 0 0" "$(reads '{}')"
expect "no settings reads as unread" "0 0 0 0 0" \
  "$(reads '{"extensions": {}}')"
expect "settings that aren't an object read as unread" "0 0 0 0 0" \
  "$(reads '{"extensions": {"settings": 3}}')"
expect "the unpatched engine's" "1 1 1 1 0" \
  "$(reads "$(settings "$PDF_VIEWER" "$GEMINI" "$CONTEXTUAL_TASKS")")"
expect "the patched engine's" "1 1 0 0 0" "$(reads "$(settings "$PDF_VIEWER")")"
expect "the control's extension, by its directory" "1 1 0 0 1" \
  "$(reads "$(settings "$PDF_VIEWER" "bbpimhejmgkpfaihkoegacmdnabmbkkk=$WORK/mine")")"
expect "another command-line extension is not the control's" "1 1 0 0 0" \
  "$(reads "$(settings "$PDF_VIEWER" "ahfgeienlihckogmohjhadlkjgocpleb" "bbpimhejmgkpfaihkoegacmdnabmbkkk=$WORK/other")")"

# MEASURED is "<mode> <shell-ran> <preferences-read> <pdf-viewer> <gemini>
# <contextual-tasks> <own-extension>".
echo
echo "the claim — the engine as built"
expect "neither extension is the pass" "pass" "$(verdict "claim 1 1 1 0 0 0")"
expect "Gemini in Chrome is a failure" "fail" "$(verdict "claim 1 1 1 1 0 0")"
expect "Contextual Tasks is a failure" "fail" "$(verdict "claim 1 1 1 0 1 0")"
expect "both are a failure" "fail" "$(verdict "claim 1 1 1 1 1 0")"
expect "and names the patch" "yes" "$(says "claim 1 1 1 1 1 0" "patch 0296")"
expect "no PDF viewer is a failure" "fail" "$(verdict "claim 1 1 0 0 0 0")"
expect "and says the none then means nothing" "yes" \
  "$(says "claim 1 1 0 0 0 0" "says nothing")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "claim 0 1 1 0 0 0")"
expect "and says so" "yes" "$(says "claim 0 1 1 0 0 0" "never ran")"
expect "Preferences unread is a failure" "fail" "$(verdict "claim 1 0 0 0 0 0")"
expect "and says so" "yes" "$(says "claim 1 0 0 0 0 0" "Preferences")"

echo
echo "the control — an extension from the command line"
expect "its extension in the Preferences is the pass" "pass" \
  "$(verdict "control 1 1 1 0 0 1")"
expect "with the unpatched engine's too" "pass" \
  "$(verdict "control 1 1 1 1 1 1")"
expect "its extension missing is the control's failure" "fail" \
  "$(verdict "control 1 1 1 0 0 0")"
expect "and says the claim's none then means nothing" "yes" \
  "$(says "control 1 1 1 0 0 0" "says nothing")"
expect "Preferences unread is a failure" "fail" \
  "$(verdict "control 1 0 0 0 0 0")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "control 0 1 1 0 0 1")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the no-chrome-component-extensions guard blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
