#!/usr/bin/env bash
# Checks that a <webview> on an https page whose certificate nothing trusts
# reports `security` as `dangerous`, the padlock a shell draws from.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-untrusted-cert.sh /build/chromium/src
#
# - The certificate is self-signed for 127.0.0.1 and made at run time.
# - The engine refuses the handshake and shows its error page in place of the
#   site, so the page itself must never load.
# - Headless: a security state draws nothing.
# - Control (`NEGATIVE=1`): the same certificate, trusted with
#   `--ignore-certificate-errors-spki-list`. The page must load and read
#   `secure`, or the positive run's `dangerous` proves nothing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-untrusted-cert: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-untrusted-cert-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-untrusted-cert-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-90}"
# How long to keep reading after the first settled state, so a later change
# is the one judged.
QUIET_SECONDS="${QUIET_SECONDS:-2}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-untrusted-cert$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-untrusted-cert$WHICH-http.log}"

STARTED=()
CERTS=""
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    # Reaped, so the engine is not writing the profile as it is removed.
    wait "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  [ -n "$CERTS" ] && rm -rf "$CERTS"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-untrusted-cert: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-untrusted-cert: no python3, and the page in the window is served by one"
  exit 77
}
command -v openssl >/dev/null || {
  skip "guard-webview-untrusted-cert: no openssl to make the certificate with"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 extended pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qE "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. A certificate no store trusts, and its SPKI hash for the control's flag.
CERTS="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 \
  -addext subjectAltName=IP:127.0.0.1 \
  -keyout "$CERTS/key.pem" -out "$CERTS/cert.pem" >"$CERTS/openssl.log" 2>&1 || {
  annotate_from "guard-webview-untrusted-cert: openssl could not make a certificate" "$CERTS/openssl.log"
  exit 1
}
SPKI="$(openssl x509 -in "$CERTS/cert.pem" -pubkey -noout |
  openssl pkey -pubin -outform der |
  openssl dgst -sha256 -binary | base64)"
TRUST=()
[ "$NEGATIVE" = "1" ] && TRUST=("--ignore-certificate-errors-spki-list=$SPKI")

# 2. The page, over https with that certificate.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 \
  --cert "$CERTS/cert.pem" --key "$CERTS/key.pem" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-untrusted-cert: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-untrusted-cert: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="https://127.0.0.1:$PORT/page"

# 3. The engine, showing the shell module as a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  "${TRUST[@]}" \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-untrusted-cert.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# The element reports `neutral` while the page commits, then its verdict.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD page-state security=(dangerous|secure) url=$SUBJECT" \
  "$ENGINE_LOG" || echo "the element never settled on a security state" >&2
sleep "$QUIET_SECONDS"

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
# The last reading, since the first is the commit's `neutral`.
LAST="$(grep -o 'GUARD page-state security=[^ ]* url=[^ "]*' "$ENGINE_LOG" | tail -1)"
SECURITY="$(printf '%s' "$LAST" | sed -n 's/^.* security=\([^ ]*\) .*$/\1/p')"
URL="$(printf '%s' "$LAST" | sed -n 's/^.* url=//p')"
SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD guest-loaded")

echo
echo "shell=$SAW_SHELL trusted=$NEGATIVE page loaded=$SAW_PAGE"
echo "the element said: security=$SECURITY url=$URL"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-untrusted-cert-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the harness did not load the module, or \
it threw"
elif [ "$URL" != "$SUBJECT" ]; then
  FAILURE="the element never reported $SUBJECT (it said \"$URL\"): \
WebViewGuest::ReportPage did not send PageChanged for the guest's page"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_PAGE" != "1" ]; then
    FAILURE="the page never loaded with its certificate trusted: \
--ignore-certificate-errors-spki-list did not match it. This is the harness, \
and the control is not a trusted connection"
  elif [ "$SECURITY" != "secure" ]; then
    FAILURE="the same page over a trusted certificate read \"$SECURITY\", not \
secure, so the positive run's dangerous proves nothing"
  else
    PASSED="the same certificate, trusted, loads the page and reads secure"
  fi
elif [ "$SAW_PAGE" = "1" ]; then
  FAILURE="the page loaded, so the engine trusted a self-signed certificate \
and this run measured a trusted connection"
elif [ "$SECURITY" != "dangerous" ]; then
  FAILURE="an https page with an untrusted certificate read \"$SECURITY\", \
not dangerous: security_state::GetSecurityLevel in WebViewGuest::ReportPage \
did not see the certificate error, or the element did not store it"
else
  PASSED="an https page whose certificate nothing trusts reads dangerous"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-untrusted-cert: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server said:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
