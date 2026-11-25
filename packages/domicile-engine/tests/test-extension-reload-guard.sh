#!/usr/bin/env bash
# Tests how `guard-extension-reload.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Each edit run in both profiles, and each load answered, passes.
#   - An edit the other profile never ran fails, and names the reload.
#   - An edit with no load_unpacked fails the claim and passes the control.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-extension-reload.sh"
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

reads() { # console lines...
  for line in "$@"; do
    printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: http://127.0.0.1:9/page (7)\n' "$line"
  done >"$WORK/engine.log"
  (
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
expect "each edit at each host, in order" "1 11 none,first,second none,first" \
  "$(reads shell-loaded profile=default "extension=none at=127.0.0.1" \
    profile=work "extension=none at=localhost" \
    "extension=first at=127.0.0.1" "extension=first at=localhost" \
    "extension=second at=127.0.0.1")"
expect "a page with no extension during a reload changes nothing" \
  "1 11 none,first,second none" \
  "$(reads shell-loaded profile=default profile=work \
    "extension=none at=127.0.0.1" "extension=none at=localhost" \
    "extension=first at=127.0.0.1" "extension=none at=127.0.0.1" \
    "extension=second at=127.0.0.1")"
expect "two windows in one profile" "1 10 none -" \
  "$(reads shell-loaded profile=default profile=default \
    "extension=none at=127.0.0.1")"
expect "an empty log reads nothing" "0 00 - -" "$(reads)"

# MEASURED is "<mode> <shell> <default><work> <edits in default> <edits in
# work> <loads answered>".
ALL="none,first,second,third"
echo
echo "the claim — loaded, loaded again, and loaded from another directory"
expect "every edit in both, every load answered is the pass" "pass" \
  "$(verdict "reloaded 1 11 $ALL $ALL 3")"
expect "an edit the other profile never ran is a failure" "fail" \
  "$(verdict "reloaded 1 11 none,first,second none,first 2")"
expect "and names the reload" "yes" \
  "$(says "reloaded 1 11 none,first,second none,first 2" "ReloadUnpackedElsewhere")"
expect "a directory the other profile never loaded is a failure" "fail" \
  "$(verdict "reloaded 1 11 $ALL none,first,second 3")"
expect "and names the choice of directory" "yes" \
  "$(says "reloaded 1 11 $ALL none,first,second 3" "ReloadUnpackedElsewhere")"
expect "a first load the other profile never ran is a failure" "fail" \
  "$(verdict "reloaded 1 11 none,first none 1")"
expect "and names the mirroring" "yes" \
  "$(says "reloaded 1 11 none,first none 1" "MirrorUserExtensions")"
expect "a refused load is a failure though every edit ran" "fail" \
  "$(verdict "reloaded 1 11 $ALL $ALL 2")"
expect "and names the answers" "yes" \
  "$(says "reloaded 1 11 $ALL $ALL 2" "answer")"
expect "a first load that reached nothing is a failure" "fail" \
  "$(verdict "reloaded 1 11 none none 0")"
expect "and names the command socket" "yes" \
  "$(says "reloaded 1 11 none none 0" "domicile-command-socket")"
expect "an edit the default profile never ran is a failure" "fail" \
  "$(verdict "reloaded 1 11 none,first none,first 2")"
expect "a page that never loaded is a failure" "fail" \
  "$(verdict "reloaded 1 11 - - 0")"
expect "and names the page" "yes" \
  "$(says "reloaded 1 11 none - 0" "page never loaded")"
expect "both windows in one profile is a failure" "fail" \
  "$(verdict "reloaded 1 10 none none 0")"
expect "and names routing" "yes" \
  "$(says "reloaded 1 10 none none 0" "ProfileForUrl")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "reloaded 0 00 - - 0")"

echo
echo "the control — edited, and never loaded again"
expect "the edit in neither is the control's pass" "pass" \
  "$(verdict "edited 1 11 none,first none,first 1")"
expect "an edit with no load is the control's failure" "fail" \
  "$(verdict "edited 1 11 none,first,second none,first 1")"
expect "and says the claim then proves nothing" "yes" \
  "$(says "edited 1 11 none,first,second none,first 1" "prove nothing")"
expect "a first load missing from a profile is the control's failure" "fail" \
  "$(verdict "edited 1 11 none,first none 1")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"

echo
echo "the fixture"
FIXTURE="$SCRIPTS/guard-extension-reload-extension"
expect "its content script is the first edit, as the guard writes the others" \
  "yes" "$(grep -qF 'document.documentElement.dataset.extension = "first";' \
    "$FIXTURE/content.js" && echo yes || echo no)"
expect "it runs at both hosts" "yes" \
  "$(grep -qF '"http://127.0.0.1/*", "http://localhost/*"' \
    "$FIXTURE/manifest.json" && echo yes || echo no)"
expect "and its key keeps its id in another directory" "yes" \
  "$(grep -q '"key": "MII' "$FIXTURE/manifest.json" && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the extension-reload guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
