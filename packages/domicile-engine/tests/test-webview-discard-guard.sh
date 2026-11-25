#!/usr/bin/env bash
# Tests `guard-webview-discard.sh`: how it cuts its log at the shell's steps,
# which readings pass, and which component a failure blames.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - A page that says nothing once unloaded counts only if the control's page
#     says something, so each leg reads the same steps.
#   - The control fails on anything unloaded.
#
# Also checks that the expected id matches the fixture's key.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-discard.sh"
FIXTURE="$SCRIPTS/guard-webview-discard-extension"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^between\(\) \{/,/^}$/' "$GUARD"; awk '/^count\(\) \{/,/^}$/' "$GUARD")"
# From `FAILURE=""` to the column-zero `fi` that ends the decision.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
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

# How many of the messages `$3` a log of the rest has between two steps.
reads() { # $1 from, $2 to, $3 message, then the log's messages
  local from="$1" to="$2" message="$3"
  shift 3
  printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: domicile://shell/ (7)\n' \
    "$@" >"$WORK/engine.log"
  (
    eval "$READING"
    between "$WORK/engine.log" "$from" "$to" | count "\"GUARD $message\""
  )
}

# Runs the block with every reading at its passing value; each case overrides
# one. Prints "pass", "fail" or "neither", then the failure on the next line.
judge() { # $1 NEGATIVE, then NAME=value overrides
  (
    SAW_SHELL=1
    SAW_SUBJECT=1
    SAW_EXTENSION=1
    SAW_REMOUNT=1
    SAW_REFUSED=1
    SAW_POPUP_REFUSED=1
    SAW_DEVTOOLS_REFUSED=1
    EARLY=0
    LISTED=1
    TICKS=0
    LOADED=1
    RESTORED=1
    RELISTED=1
    SAW_UNMOUNTED=1
    SAW_DONE=1
    SAW_TYPED=1
    AUTO_PLAIN=1
    AUTO_TYPED=0
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

verdict() { judge "$@" | head -1; }

blames() { # $1 word, then the args judge takes
  local word="$1"
  shift
  case "$(judge "$@" | tail -n +2)" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

# The control asks for nothing, so the page lives on and nothing is unloaded.
CONTROL=(SAW_POPUP_REFUSED=0 SAW_DEVTOOLS_REFUSED=0 LISTED=0 TICKS=4
  LOADED=0 RESTORED=0 RELISTED=0 AUTO_PLAIN=0)

echo "reading the log"
expect "only what the page said between the steps counts" "1" \
  "$(reads quiet remounting "tick name=subject-2" "tick name=subject-2" quiet \
    "tick name=subject-2" remounting "tick name=subject-2")"
expect "another page's lines do not" "0" \
  "$(reads quiet remounting "tick name=subject-2" quiet "tick name=active" \
    remounting)"
expect "asked-attached is not asked" "0" \
  "$(reads asked remounting "tick" asked-attached tick)"

echo
echo "a run that never got as far as measuring anything"
expect "a shell that never ran blames the harness" "yes" \
  "$(blames "harness" 0 SAW_SHELL=0)"
expect "no subject names the guest" "yes" "$(blames "the guest" 0 SAW_SUBJECT=0)"
expect "no extension names the installer" "yes" \
  "$(blames "the installer" 0 SAW_EXTENSION=0)"
expect "a manual shell that stopped is a failure" "fail" \
  "$(verdict 0 SAW_REMOUNT=0)"
expect "an automatic shell that stopped is a failure" "fail" \
  "$(verdict 0 SAW_DONE=0)"
expect "a page nobody typed into blames the harness" "yes" \
  "$(blames "harness" 0 SAW_TYPED=0)"

echo
echo "the positive run"
expect "every reading is the pass" "pass" "$(verdict 0)"
expect "a shown window that was not refused names IsAttached" "yes" \
  "$(blames "IsAttached" 0 SAW_REFUSED=0)"
expect "so does one that was unloaded" "yes" "$(blames "IsAttached" 0 EARLY=1)"
expect "a subject never listed names DiscardWindow" "yes" \
  "$(blames "DiscardWindow" 0 LISTED=0)"
expect "an old page that runs on names Reap" "yes" "$(blames "Reap" 0 TICKS=3)"
expect "an unloaded popup window is a failure" "yes" \
  "$(blames "popup window" 0 SAW_POPUP_REFUSED=0)"
expect "an unloaded DevTools window is a failure" "yes" \
  "$(blames "DevTools window" 0 SAW_DEVTOOLS_REFUSED=0)"
expect "a page that lost its history or scroll names CopyStateFrom" "yes" \
  "$(blames "CopyStateFrom" 0 RESTORED=0)"
expect "a loaded page listed unloaded names the Watch" "yes" \
  "$(blames "the Watch" 0 RELISTED=0)"
expect "no automatic unload names PageDiscarding" "yes" \
  "$(blames "PageDiscarding" 0 AUTO_PLAIN=0)"
expect "unloading the typed page names HadUserEdits" "yes" \
  "$(blames "HadUserEdits" 0 AUTO_TYPED=1)"

echo
echo "the control run"
expect "a page nobody unloads is the pass" "pass" "$(verdict 1 "${CONTROL[@]}")"
expect "a listed subject is the control's failure" "fail" \
  "$(verdict 1 "${CONTROL[@]}" LISTED=1)"
expect "a silent page is the control's failure" "yes" \
  "$(blames "silence" 1 "${CONTROL[@]}" TICKS=0)"
expect "a page that loads again is the control's failure" "fail" \
  "$(verdict 1 "${CONTROL[@]}" LOADED=1)"
expect "an automatic unload is the control's failure" "yes" \
  "$(blames "shortage" 1 "${CONTROL[@]}" AUTO_PLAIN=1)"
expect "a shown window that was not refused fails the control too" "fail" \
  "$(verdict 1 "${CONTROL[@]}" SAW_REFUSED=0)"

echo
echo "the fixture"
ID="$(sed -n 's/^readonly ID="\([a-p]\{32\}\)"$/\1/p' "$GUARD")"
KEY="$(sed -n 's/^ *"key": "\([^"]*\)",$/\1/p' "$FIXTURE/manifest.json")"
MADE="$(printf '%s' "$KEY" | base64 -d 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
expect "the guard names an id" "yes" "$([ -n "$ID" ] && echo yes || echo no)"
expect "and it is the one the fixture's key makes" "$ID" "$MADE"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the discard guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
