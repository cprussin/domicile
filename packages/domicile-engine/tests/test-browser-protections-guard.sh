#!/usr/bin/env bash
# Tests how `guard-browser-protections.sh` reads the engine's and the page
# server's logs and which results it passes.
#
# Runs the guard's own reading and verdict blocks, not copies. Key cases:
#
#   - The default profile asking for privacy and blocking the other site's
#     cookie, and `work` doing neither, passes.
#   - A page that asks for privacy without the header fails, and names the
#     network side.
#   - A cookie the other site kept in the default profile fails.
#   - A `work` page that still asks for privacy fails: the profile's own
#     setting is not what turned it on.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-browser-protections.sh"
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
# one `sec-gpc` line per `header=AS` argument.
log() { # lines...
  : >"$WORK/engine.log"
  : >"$WORK/http.log"
  for line in "$@"; do
    case "$line" in
    header=*)
      printf 'GUARD sec-gpc as=%s value=1\n' "${line#header=}" >>"$WORK/http.log"
      printf '127.0.0.1 - "GET /page?as=%s HTTP/1.1" 200 -\n' "${line#header=}" >>"$WORK/http.log"
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

echo "reading the logs"
expect "both profiles as configured" "1 true 1 blocked false 0 kept" \
  "$(reads shell-loaded header=default "gpc as=default value=true" \
    "cookie as=default third-party=blocked" "gpc as=work value=false" \
    "cookie as=work third-party=kept")"
expect "a page that never reported" "1 none 0 none none 0 none" \
  "$(reads shell-loaded)"
expect "an empty log reads nothing" "0 none 0 none none 0 none" "$(reads)"
expect "a header for work counts for work only" "1 true 0 blocked false 1 kept" \
  "$(reads shell-loaded header=work "gpc as=default value=true" \
    "cookie as=default third-party=blocked" "gpc as=work value=false" \
    "cookie as=work third-party=kept")"

# MEASURED is "<shell> <default gpc> <default header> <default cookie>
# <work gpc> <work header> <work cookie>".
echo
echo "the verdict"
expect "default protected and work not is the pass" "pass" \
  "$(verdict "1 true 1 blocked false 0 kept")"
expect "a shell that never ran is a failure" "fail" \
  "$(verdict "0 none 0 none none 0 none")"
expect "no GPC in the default profile is a failure" "fail" \
  "$(verdict "1 false 0 blocked false 0 kept")"
expect "and names the feature" "yes" \
  "$(says "1 false 0 blocked false 0 kept" "kUniversalOptOutSettings")"
expect "GPC on the page but not the wire is a failure" "fail" \
  "$(verdict "1 true 0 blocked false 0 kept")"
expect "and names the network side" "yes" \
  "$(says "1 true 0 blocked false 0 kept" "Sec-GPC")"
expect "a third-party cookie kept in default is a failure" "fail" \
  "$(verdict "1 true 1 kept false 0 kept")"
expect "and names the cookie setting" "yes" \
  "$(says "1 true 1 kept false 0 kept" "kCookieControlsMode")"
expect "work still asking for privacy is a failure" "fail" \
  "$(verdict "1 true 1 blocked true 1 kept")"
expect "and says the setting is not the profile's" "yes" \
  "$(says "1 true 1 blocked true 1 kept" "not the profile")"
expect "work blocking the cookie is a failure" "fail" \
  "$(verdict "1 true 1 blocked false 0 blocked")"
expect "and says the claim then proves nothing" "yes" \
  "$(says "1 true 1 blocked false 0 blocked" "proves nothing")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the browser-protections guard reads its logs and blames the right end"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
