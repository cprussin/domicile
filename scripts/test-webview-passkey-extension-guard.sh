#!/usr/bin/env bash
# Tests the verdict of `guard-webview-passkey-extension.sh`: which readings
# pass and which component a failure blames.
#
# Runs the verdict block from the real guard. Key case: a control whose page
# never painted a refusal fails, because "no answer without the extension"
# and "no PublicKeyCredential at all" both leave the color absent.
#
# Also checks that the guard's color is the one the page paints for an
# answer, and that the page expects the answer the fixture gives.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-passkey-extension.sh"
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

# Prints pass, fail or neither. Sentences are not compared, since they change.
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

# Whether the failure message contains `$2`, i.e. blames the right component.
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

echo "the claim — the extension loaded, which must answer the page"
expect "answered is a pass" "pass" "$(verdict "answered 0")"
expect "unanswered is a failure" "fail" "$(verdict "answered 1")"
expect "and names the delegate the proxy needs" "yes" \
  "$(says "answered 1" "GetWebAuthenticationRequestDelegate")"
expect "and Blink's WebAuth" "yes" "$(says "answered 1" "WebAuth is off")"
expect "and the opaque frame's question the browser died on" "yes" \
  "$(says "answered 1" "opaque")"
expect "nothing measured is a failure" "fail" "$(verdict "answered 2")"
expect "nothing measured blames the harness" "yes" \
  "$(says "answered 2" "harness")"
expect "an unusable probe fails" "fail" "$(verdict "answered 3")"
expect "and a killed one does not pass either" "fail" \
  "$(verdict "answered 137")"

expect "a probe stuck on a dead browser fails" "fail" \
  "$(verdict "answered 124")"
expect "and says the browser stopped answering" "yes" \
  "$(says "answered 124" "stopped answering")"

echo
echo "the control — no extension, which must be refused"
expect "refused and unanswered is the pass" "pass" "$(verdict "refused 1")"

# Inverted: the control finding the color is the failure.
expect "an answer with no extension is a failure" "fail" \
  "$(verdict "refused 0")"
expect "and says the answer is not the fixture's" "yes" \
  "$(says "refused 0" "not the fixture's")"

# The case the refusal witness exists for.
expect "no refusal painted is a failure, though the answer is absent too" \
  "fail" "$(verdict "refused 2")"
expect "and names the missing API" "yes" \
  "$(says "refused 2" "PublicKeyCredential")"
expect "and a request the browser holds" "yes" \
  "$(says "refused 2" "dialog")"
expect "and the opaque frame's question the browser died on" "yes" \
  "$(says "refused 2" "opaque")"
expect "and a conditional get() answered at once" "yes" \
  "$(says "refused 2" "conditional")"
expect "an unusable probe fails" "fail" "$(verdict "refused 3")"
expect "a probe stuck on a dead browser fails" "fail" \
  "$(verdict "refused 124")"
expect "and says the browser stopped answering" "yes" \
  "$(says "refused 124" "stopped answering")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a mode nobody runs" "fail" "$(verdict "elephant 0")"

echo
echo "the fixture"
COLOR="$(sed -n 's/^readonly COLOR="\([0-9A-F]\{6\}\)"$/\1/p' "$GUARD")"
expect "the guard names its color" "yes" \
  "$([ -n "$COLOR" ] && echo yes || echo no)"
expect "and gives it to the page as the answer's" "yes" \
  "$(grep -qF -- '--answered "$COLOR"' "$GUARD" && echo yes || echo no)"
FIXTURE="$(sed -n 's/^const ANSWER = "\(.*\)";$/\1/p' \
  "$SCRIPTS/guard-webview-passkey-extension-extension/background.js")"
PAGE="$(sed -n 's/^ANSWER = "\(.*\)"$/\1/p' \
  "$SCRIPTS/guard-webview-passkey-extension-server.py")"
expect "the fixture names its answer" "yes" \
  "$([ -n "$FIXTURE" ] && echo yes || echo no)"
expect "and the page knows it by the same message" "$FIXTURE" "$PAGE"
# A proxied origin's conditional get() is refused upstream, so only the
# control, with no extension, can ask one and see it held.
expect "the control's page asks a conditional get() first" "yes" \
  "$(grep -qF 'PAGE="$PAGE?conditional"' "$GUARD" && echo yes || echo no)"
expect "and the page knows what that is" "yes" \
  "$(grep -qF 'mediation: "conditional"' \
    "$SCRIPTS/guard-webview-passkey-extension-server.py" && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the passkey-extension guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
