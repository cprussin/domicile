#!/usr/bin/env bash
# Which end the untrusted certificate guard blames, and which runs it calls a
# pass.
#
# The unit is the verdict block in `guard-webview-untrusted-cert.sh`, run out
# of the real script rather than copied, so a rewrite that moves it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-untrusted-cert.sh"
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

# A passing positive run; each case changes one reading. Prints the verdict,
# then the failing sentence.
run_block() { # $1 NEGATIVE, then NAME=value overrides
  (
    SUBJECT="https://127.0.0.1:4430/page"
    SAW_SHELL=1
    URL="$SUBJECT"
    SECURITY="dangerous"
    SAW_PAGE=0
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

# The control's own shape: the certificate is trusted, so the page loads and
# reads secure.
control() {
  verdict 1 SAW_PAGE=1 SECURITY=secure "$@"
}

echo "a run that never reached the page"
expect "a shell that never ran is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "and blames the harness" "yes" "$(blames "harness" 0 SAW_SHELL=0)"
expect "no address reported is a failure" "fail" "$(verdict 0 URL=)"
expect "and names PageChanged" "yes" "$(blames "PageChanged" 0 URL=)"
expect "in the control too" "fail" "$(control URL=)"

echo
echo "the positive run -- a certificate nothing trusts"
expect "dangerous is the pass" "pass" "$(verdict 0)"
expect "neutral is a failure" "fail" "$(verdict 0 SECURITY=neutral)"
expect "and names the security state" "yes" \
  "$(blames "GetSecurityLevel" 0 SECURITY=neutral)"
expect "secure is a failure" "fail" "$(verdict 0 SECURITY=secure)"
expect "no reading is a failure" "fail" "$(verdict 0 SECURITY=)"
expect "a page that loaded is a failure, even when dangerous" "fail" \
  "$(verdict 0 SAW_PAGE=1)"
expect "and says the certificate was trusted" "yes" \
  "$(blames "trusted" 0 SAW_PAGE=1)"

echo
echo "the control run -- the same certificate, trusted"
expect "a loaded page reading secure is the pass" "pass" "$(control)"
expect "dangerous is the control's failure" "fail" "$(control SECURITY=dangerous)"
expect "and says the positive run proves nothing" "yes" \
  "$(blames "proves nothing" 1 SAW_PAGE=1 SECURITY=dangerous)"
expect "a page that never loaded is the harness" "fail" "$(control SAW_PAGE=0)"
expect "and names the trust flag" "yes" \
  "$(blames "spki" 1 SAW_PAGE=0 SECURITY=secure)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the untrusted certificate guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) blamed the wrong end" >&2
exit 1
