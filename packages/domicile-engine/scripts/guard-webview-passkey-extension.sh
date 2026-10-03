#!/usr/bin/env bash
# A passkey extension answering a page's WebAuthn request in a <webview>.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-passkey-extension.sh /build/chromium/src
#
# WHY THIS EXISTS. Patch 0048 draws no WebAuthn UI: Chrome's dialog has no
# browser window to belong to, so the browser refuses a request itself. A
# passkey still has somewhere to come from, and that is an extension -- by a
# content script wrapping navigator.credentials, which needs the page to have
# PublicKeyCredential, or by chrome.webAuthenticationProxy, which content hands
# the request to before any dialog and only once the browser gave it a
# delegate. This is both, read in the window a site actually runs in.
#
# Before either, a sandboxed frame on the page asks
# isUserVerifyingPlatformAuthenticatorAvailable() from an opaque origin, which
# a DCHECK in content answered by aborting the browser (patch 0069). Both legs
# ask it, and a browser that died paints neither answer.
#
# Before that, the control's page asks what a site offering a passkey from an
# extension's autofill asks: isConditionalMediationAvailable(), which must be
# true, and a conditional get(), which the browser must hold until the page
# aborts it (patch 0083). Bitwarden races its answer against the browser's, and
# a refusal won. Only the control: upstream refuses a proxied origin's.
#
# Headless and software-composited, as `guard-webview-content-script.sh`, whose
# shell module this reuses: one <webview> on the witness.
#
# THE EXTENSION is `guard-webview-passkey-extension-extension/`, unpacked,
# loaded by `--load-extension` with `DisableLoadExtensionCommandLineSwitch`
# disabled. It attaches to webAuthenticationProxy and answers every create()
# with an error the page knows by its message. THE PAGE is
# `guard-webview-passkey-extension-server.py`'s: it asks, paints `COLOR` for
# the fixture's answer and `REFUSED` for any other, and asks again.
#
# WHAT IT ASSERTS. That `COLOR` is somewhere in the window, with the shell's
# background as the witness.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same <webview> on the same
# page, extension NOT loaded. It MUST NOT show `COLOR`, and its witness is
# `REFUSED` -- which the page paints only once it found PublicKeyCredential,
# asked, and was told no. So the claim's answer is the extension's, and
# without one a site sees the API and gets a refusal rather than a request the
# browser holds on a dialog nobody can see.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-passkey-extension: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The fixture's answer, painted. Fixed rather than overridable:
# `scripts/test-webview-passkey-extension-guard.sh` holds it to the page.
readonly COLOR="5E35B1"
# The shell's background; the page's before it has an answer, its refusal, and
# its finding no API. No other guard's.
WITNESS="${WITNESS:-1C2E3A}"
PAGE_COLOR="${PAGE_COLOR:-B0BEC5}"
REFUSED="${REFUSED:-EF6C00}"
NO_API="${NO_API:-C2185B}"
UNHELD="${UNHELD:-4E342E}"

EXTENSION="$SCRIPTS/guard-webview-passkey-extension-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-passkey-extension-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-passkey-extension-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-passkey-extension-engine.log}"
PROBE_LOG="${PROBE_LOG:-/tmp/domicile-webview-passkey-extension-probe.log}"
# One per leg: the control runs straight after the claim.
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-passkey-extension-http-$NEGATIVE.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-passkey-extension: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-webview-passkey-extension: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-passkey-extension: no python3, and the page this measures is served by one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The page. Its own server: `crux` reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-passkey-extension-server.py" \
  --port 0 --color "$PAGE_COLOR" --answered "$COLOR" --refused "$REFUSED" \
  --no-api "$NO_API" --unheld "$UNHELD" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$HTTP_LOG" 2>/dev/null || {
  annotate_from "guard-webview-passkey-extension: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-passkey-extension: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
# `localhost`, not the address it listens on: see the server's docstring.
PAGE="http://localhost:$PORT/page"

# The claim loads the extension; the control does not, and its witness is the
# page's refusal.
EXTENSION_FLAG=()
if [ "$NEGATIVE" = "1" ]; then
  LEG=refused
  PAGE="$PAGE?conditional"
  WITNESSED="$REFUSED"
  FOR_SECONDS="$(budget_for webview-passkey-extension "$FOR_SECONDS")"
else
  LEG=answered
  WITNESSED="$WITNESS"
  EXTENSION_FLAG=("--load-extension=$EXTENSION")
fi

# 2. The engine. The feature is disabled in both legs, so they differ in
#    `--load-extension` and nothing else.
STARTED_AT="$(date +%s)"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?witness=$WITNESS&src=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-content-script.js" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  ${EXTENSION_FLAG[@]+"${EXTENSION_FLAG[@]}"} \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do
  [ -S "$BROKER" ] && break
  sleep 0.5
done
[ -S "$BROKER" ] || {
  annotate_from "guard-webview-passkey-extension: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER, showing $PAGE in a <webview>"

# 3. The reading: the probe watches until it sees `COLOR`, or gives up. Under
#    `timeout`: a probe whose browser died waits on its reply forever, and a
#    browser this page aborted held a CI run for seven hours. 124 is the
#    verdict's.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  timeout "$((FOR_SECONDS + 30))" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

# Only on a pass: a failed run measured this script's patience.
if [ "$NEGATIVE" != "1" ] && [ "$STATUS" -eq 0 ]; then
  budget_note webview-passkey-extension "$(($(date +%s) - STARTED_AT))"
fi

MEASURED="$LEG $STATUS"
echo
echo "measured: $MEASURED"
echo "what the page and the fixture said:"
grep -F '"GUARD ' "$ENGINE_LOG" | tail -5 || true

# WHICH END TO BLAME. `scripts/test-webview-passkey-extension-guard.sh` runs
# this block directly. The probe's status is 0 for the color seen, 1 for the
# witness alone, 2 for neither; 124 is `timeout`'s.
FAILURE=""
PASSED=""
case "$MEASURED" in
"answered 0")
  PASSED="a passkey extension answered a page's create() in a <webview>, so \
the browser handed the request on rather than refusing it"
  ;;
"answered 1")
  FAILURE="the page drew and no extension answered it: it found no \
PublicKeyCredential (Blink's WebAuth is off), or the browser refused the \
request with the fixture attached (GetWebAuthenticationRequestDelegate \
answered null), or the fixture never attached, or the browser died on the \
opaque frame's isUserVerifyingPlatformAuthenticatorAvailable() (patch 0069) \
-- the GUARD lines above say which"
  ;;
"answered 2")
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the extension"
  ;;
"answered 124" | "refused 124")
  FAILURE="the browser stopped answering the probe, so it died mid-run: \
the opaque frame's isUserVerifyingPlatformAuthenticatorAvailable() aborting \
it (patch 0069) is the one this page knows -- the engine's last words below \
say which"
  ;;
"answered "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"refused 1")
  PASSED="the control is sharp: with no extension the same page found \
PublicKeyCredential, asked, and was refused -- so the claim's answer is the \
extension's, and the browser holds no request on a dialog"
  ;;
"refused 0")
  FAILURE="the page was answered with no extension loaded, so the answer is \
not the fixture's and the claim proves nothing"
  ;;
"refused 2")
  FAILURE="the page never painted a refusal: it found no PublicKeyCredential \
(Blink's WebAuth is off, and a content-script passkey extension has nothing to \
wrap), or the browser said there is no conditional UI or answered a \
conditional get() rather than holding it (patch 0083), or its request never \
came back (the browser is holding it, on a dialog \
nobody can see), or the browser died on the opaque frame's \
isUserVerifyingPlatformAuthenticatorAvailable() (patch 0069), or the guest \
never drew -- the GUARD lines above say which"
  ;;
"refused "*)
  FAILURE="the probe did not run for the control ($MEASURED), so it measured \
nothing"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the probe \
did not run, or ran for something this guard does not know how to read"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-passkey-extension: $FAILURE" "$ENGINE_LOG"
echo "the engine's last words ($ENGINE_LOG):" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
