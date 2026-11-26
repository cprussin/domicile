#!/usr/bin/env bash
# Tests how `guard-site-privacy.sh` reads the engine's log and which results
# it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - Off for a's window, then the site in both, then back, each read back
#     right, passes.
#   - A window's setting that reaches the other window fails.
#   - Pages blocked right but read back wrong fails, and names the report.
#   - The Settings app's change, listed and cleared from the command socket and
#     reported to the open page, passes; a wrong list or no report fails.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-site-privacy.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^READ="\$\(awk/,/"\$ENGINE_LOG" 2>\/dev\/null\)"$/' "$GUARD")"
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

# The command socket's answers, one line per argument, for the next `reads`.
answers() { # lines...
  : >"$WORK/answers.log"
  for line in "$@"; do
    printf 'SETTINGS %s\n' "$line" >>"$WORK/answers.log"
  done
}

# The engine's log, one console line per argument.
reads() { # lines...
  : >"$WORK/engine.log"
  for line in "$@"; do
    printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: domicile://shell/x.js (7)\n' "$line" >>"$WORK/engine.log"
  done
  (
    ENGINE_LOG="$WORK/engine.log"
    ANSWERS="$WORK/answers.log"
    touch "$ANSWERS"
    eval "$READING"
    echo "$READ"
  )
}

verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    ANSWERS="$WORK/answers.log"
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
    ANSWERS="$WORK/answers.log"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

blocked() { echo "ads as=$1 third=blocked first=loaded mine=blocked allowed=loaded ok=loaded"; }
loaded() { echo "ads as=$1 third=loaded first=loaded mine=loaded allowed=loaded ok=loaded"; }
read_() { # step view mode for blocked
  echo "privacy step=$1 view=$2 site=127.0.0.1 mode=$3 for=$4 blocked=$5"
}

TOLD="standard/profile/2 off/window/0 standard/profile/2 off/site/0 off/site/0 standard/profile/2"
SETTINGS_OK="set default:127.0.0.1:strict set none strict/site,standard/profile"
PASS="1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK"
NO_SETTINGS="? ? ? ? ?"

echo "reading the log"
answers set1=set list1=default:127.0.0.1:strict set2=set list2=none
expect "every step as set" "$PASS" \
  "$(reads shell-loaded \
    "$(blocked a1)" "$(read_ 1 a standard profile 2)" \
    "$(loaded a2)" "$(read_ 2 a off window 0)" \
    "$(blocked b1)" "$(read_ 3 b standard profile 2)" \
    "$(loaded a3)" "$(read_ 4 a off site 0)" \
    "$(loaded b2)" "$(read_ 4 b off site 0)" \
    "$(blocked b3)" "$(read_ 5 b standard profile 2)" \
    "privacy done" \
    "privacy later view=b mode=strict for=site" \
    "privacy later view=b mode=strict for=site" \
    "privacy later view=b mode=standard for=profile")"
answers
expect "a shell that never finished" "1 0 BLBLL ????? ????? ????? ????? ????? 127.0.0.1 standard/profile/2 ? ? ? ? ? $NO_SETTINGS" \
  "$(reads shell-loaded "$(blocked a1)" "$(read_ 1 a standard profile 2)")"
expect "an empty log reads nothing" "0 0 ????? ????? ????? ????? ????? ????? ? ? ? ? ? ? ? $NO_SETTINGS" "$(reads)"

echo
echo "the verdict"
expect "every step as set is the pass" "pass" "$(verdict "$PASS")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "0 0 ????? ????? ????? ????? ????? ????? ? ? ? ? ? ? ? $NO_SETTINGS")"
expect "a shell that never finished is a failure" "fail" \
  "$(verdict "1 0 BLBLL ????? ????? ????? ????? ????? 127.0.0.1 standard/profile/2 ? ? ? ? ? $NO_SETTINGS")"
expect "a window still blocked once off is a failure" "fail" \
  "$(verdict "1 1 BLBLL BLBLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK")"
expect "and names the window's setting" "yes" \
  "$(says "1 1 BLBLL BLBLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK" "SetAdBlockingForWindow")"
expect "a window's setting in another window is a failure" "fail" \
  "$(verdict "1 1 BLBLL LLLLL LLLLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK")"
expect "and says so" "yes" \
  "$(says "1 1 BLBLL LLLLL LLLLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK" "REACHED ANOTHER WINDOW")"
expect "the site's setting missing a window is a failure" "fail" \
  "$(verdict "1 1 BLBLL LLLLL BLBLL LLLLL BLBLL BLBLL 127.0.0.1 $TOLD $SETTINGS_OK")"
expect "a site's setting that stays once cleared is a failure" "fail" \
  "$(verdict "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL LLLLL 127.0.0.1 $TOLD $SETTINGS_OK")"
expect "a page blocked right but read back wrong is a failure" "fail" \
  "$(verdict "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 standard/profile/2 off/site/0 standard/profile/2 off/site/0 off/site/0 standard/profile/2 $SETTINGS_OK")"
expect "and names the report" "yes" \
  "$(says "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 standard/profile/0 off/window/0 standard/profile/2 off/site/0 off/site/0 standard/profile/2 $SETTINGS_OK" "SitePrivacyChanged")"

expect "a refused change from Settings is a failure" "yes" \
  "$(says "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD refused ? ? ? ?" "REFUSED A SITE'S AD BLOCKING")"
expect "a list without the site is a failure" "yes" \
  "$(says "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD set none set none ?" "list of sites was wrong")"
expect "a change the open page never heard is a failure" "yes" \
  "$(says "1 1 BLBLL LLLLL BLBLL LLLLL LLLLL BLBLL 127.0.0.1 $TOLD set default:127.0.0.1:strict set none ?" "did not reach the open page")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the site-privacy guard reads its log and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
