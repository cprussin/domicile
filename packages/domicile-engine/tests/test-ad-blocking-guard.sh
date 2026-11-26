#!/usr/bin/env bash
# Tests how `guard-ad-blocking.sh` reads the engine's and the page server's
# logs and which results it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - default blocking another site's listed script, strict the page's own too,
#     and off loading everything passes.
#   - A blocked script the server served anyway fails: the block was not the
#     blocker's.
#   - off blocking anything fails: the control proves nothing then.
#   - off hiding anything, or dropping a parameter, fails for the same reason.
#   - Each wrong letter names the part of the blocker it points at.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-ad-blocking.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

READING="$(awk '/^READ="\$\(awk/,/"\$HTTP_LOG" 2>\/dev\/null\)"$/' "$GUARD")"
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

# Writes the engine's log, one console line per argument, and the server's,
# one `served` line per `served=AS:WHAT` argument.
log() { # lines...
  : >"$WORK/engine.log"
  : >"$WORK/http.log"
  for line in "$@"; do
    case "$line" in
    served=*)
      line="${line#served=}"
      printf 'GUARD served as=%s what=%s\n' "${line%%:*}" "${line#*:}" >>"$WORK/http.log"
      printf '127.0.0.1 - "GET /x.js?as=%s HTTP/1.1" 200 -\n' "${line%%:*}" >>"$WORK/http.log"
      ;;
    *)
      printf '[1:1:INFO:CONSOLE(7)] "GUARD %s", source: http://127.0.0.1:9/page (7)\n' "$line" >>"$WORK/engine.log"
      ;;
    esac
  done
}

reads() { # lines...
  log "$@"
  (
    ENGINE_LOG="$WORK/engine.log"
    HTTP_LOG="$WORK/http.log"
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

ads() { # $1 as, then third first mine allowed ok
  echo "ads as=$1 third=$2 first=$3 mine=$4 allowed=$5 ok=$6"
}

hidden() { # $1 as, then site generic complex late kept plain
  echo "hidden as=$1 site=$2 generic=$3 complex=$4 late=$5 kept=$6 plain=$7"
}

landed() { # $1 as, then keep fbclid utm_source
  echo "landed as=$1 keep=$2 fbclid=$3 utm_source=$4"
}

echo "reading the logs"
expect "the three profiles as configured" "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" \
  "$(reads shell-loaded \
    "$(ads default blocked loaded blocked loaded loaded)" \
    "$(ads strict blocked blocked blocked loaded loaded)" \
    "$(ads off loaded loaded loaded loaded loaded)" \
    "$(hidden default hidden hidden hidden hidden shown shown)" \
    "$(hidden strict hidden hidden hidden hidden shown shown)" \
    "$(hidden off shown shown shown shown shown shown)" \
    "$(landed default kept dropped kept)" \
    "$(landed strict kept dropped dropped)" \
    "$(landed off kept kept kept)" \
    served=default:first served=default:allowed served=default:ok \
    served=off:third served=off:mine)"
expect "a page that never reported" "1 ????? ????? ????? 0 ?????? ?????? ?????? ??? ??? ???" "$(reads shell-loaded)"
expect "an empty log reads nothing" "0 ????? ????? ????? 0 ?????? ?????? ?????? ??? ??? ???" "$(reads)"
expect "a blocked script the server served is a leak" "1 BLBLL ????? ????? 1 ?????? ?????? ?????? ??? ??? ???" \
  "$(reads shell-loaded "$(ads default blocked loaded blocked loaded loaded)" \
    served=default:third)"
expect "a script served for another profile is not" "1 BLBLL ????? ????? 0 ?????? ?????? ?????? ??? ??? ???" \
  "$(reads shell-loaded "$(ads default blocked loaded blocked loaded loaded)" \
    served=off:third)"

# MEASURED is "<shell> <default> <strict> <off> <leaked> <default> <strict>
# <off> <default> <strict> <off>", each profile as third first mine allowed
# ok, then as site generic complex late kept plain, then as keep fbclid
# utm_source.
echo
echo "the verdict"
expect "the three profiles as configured is the pass" "pass" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "0 ????? ????? ????? 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "a page that never reported is a failure" "fail" \
  "$(verdict "1 BLBLL ????? LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "a served blocked script is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 1 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and says it failed after the network" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 1 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "after the network")"
expect "off blocking anything is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL BLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and says the claim then proves nothing" "yes" \
  "$(says "1 BLBLL BBBLL LLBLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "prove nothing")"
expect "default loading another site's listed script is a failure" "fail" \
  "$(verdict "1 LLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the proxy" "yes" \
  "$(says "1 LLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "ProxyAdBlocking")"
expect "default blocking the page's own is a failure" "fail" \
  "$(verdict "1 BBBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names standard's third-party check" "yes" \
  "$(says "1 BBBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "third_party")"
expect "the user's rule not blocking is a failure" "fail" \
  "$(verdict "1 BLLLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names block_rules" "yes" \
  "$(says "1 BLLLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "block_rules")"
expect "the exception blocked is a failure" "fail" \
  "$(verdict "1 BLBLL BBBBL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names exceptions" "yes" \
  "$(says "1 BLBLL BBBBL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "exception")"
expect "an unlisted script blocked is a failure" "fail" \
  "$(verdict "1 BLBLB BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "strict loading the page's own is a failure" "fail" \
  "$(verdict "1 BLBLL BLBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the strict mode" "yes" \
  "$(says "1 BLBLL BLBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "AdBlockingModeOf")"
expect "strict loading what default blocked is a failure" "fail" \
  "$(verdict "1 BLBLL LLLLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and says the mode is not strict's" "yes" \
  "$(says "1 BLBLL LLLLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKK" "not the one used")"

expect "off hiding anything is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSHSSS KDK KDD KKK")"
expect "and says the claim then proves nothing" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS HSSSSS KDK KDD KKK" "proves nothing")"
expect "default hiding nothing is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 SSSSSS SSSSSS SSSSSS KDK KDD KKK")"
expect "and names the renderer's hook" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 SSSSSS SSSSSS SSSSSS KDK KDD KKK" "patch 0292")"
expect "the site's own rule not hiding is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 SHHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names CosmeticsFor" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 SHHHSS HHHHSS SSSSSS KDK KDD KKK" "CosmeticsFor")"
expect "a generic class not hiding is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HSHHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the gathering" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HSHHSS HHHHSS SSSSSS KDK KDD KKK" "Gather")"
expect "a generic rule that is not a class not hiding is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHSHSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the generic selectors" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHSHSS HHHHSS SSSSSS KDK KDD KKK" "generic selectors")"
expect "a late class not hiding is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHSSS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the timer" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHSSS HHHHSS SSSSSS KDK KDD KKK" "timer")"
expect "the site's exception hidden is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHHS HHHHSS SSSSSS KDK KDD KKK")"
expect "and names the exceptions" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHHS HHHHSS SSSSSS KDK KDD KKK" "exceptions")"
expect "an unnamed element hidden is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSH HHHHSS SSSSSS KDK KDD KKK")"
expect "strict hiding other than default is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS SSSSSS SSSSSS KDK KDD KKK")"
expect "and says they are the same" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS SSSSSS SSSSSS KDK KDD KKK" "same")"

expect "off losing a parameter is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KDK")"
expect "and says the drops then prove nothing" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDD KKD" "prove nothing")"
expect "a link losing a parameter that is no tracking is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS DDK KDD KKK")"
expect "and names WithoutTracking" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK DDD KKK" "WithoutTracking drops")"
expect "default keeping the click id is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KKK KDD KKK")"
expect "and names the throttle" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KKK KDD KKK" "MaybeCreateAndAdd")"
expect "default dropping the campaign parameter is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDD KDD KKK")"
expect "strict keeping the campaign parameter is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDK KKK")"
expect "and names strict's mode" "yes" \
  "$(says "1 BLBLL BBBLL LLLLL 0 HHHHSS HHHHSS SSSSSS KDK KDK KKK" "strict profile's mode")"
expect "strict hiding other than default, with every link right, is a failure" "fail" \
  "$(verdict "1 BLBLL BBBLL LLLLL 0 HHHHSS HHSHSS SSSSSS KDK KDD KKK")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the ad-blocking guard reads its logs and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
