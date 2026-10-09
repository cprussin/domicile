#!/usr/bin/env bash
# Checks that a passkey extension can answer a page's WebAuthn request in a
# <webview> (patches 0048, 0069, 0084). See
# packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-passkey-extension.sh /build/chromium/src
#
# Patch 0048 draws no WebAuthn UI, since Chromium's dialog has no browser window
# to attach to, so the browser refuses requests itself. Passkeys come from
# extensions instead, either by a content script wrapping navigator.credentials
# (which needs PublicKeyCredential) or by chrome.webAuthenticationProxy. This
# checks both.
#
# Both legs first ask isUserVerifyingPlatformAuthenticatorAvailable() from a
# sandboxed frame with an opaque origin. Patch 0069 keeps that from aborting the
# browser on a DCHECK.
#
# The control first checks conditional mediation:
# isConditionalMediationAvailable() must be true, and the browser must hold a
# conditional get() until the page aborts it (patch 0084). Bitwarden races its
# answer against the browser's, so an immediate refusal would win. Only the
# control checks this, because upstream refuses a conditional get() from a
# proxied origin.
#
# Runs headless with software compositing, reusing
# `guard-webview-content-script.js`: one <webview> on the witness color.
#
# The extension, `guard-webview-passkey-extension-extension/`, is loaded with
# `--load-extension` (with `DisableLoadExtensionCommandLineSwitch` disabled). It
# answers every create() with an error the page recognizes by its message. The
# page (`guard-webview-passkey-extension-server.py`) paints `COLOR` for that
# answer, `REFUSED` for any other, and retries.
#
# Passes when `COLOR` appears, with the shell's background as the witness.
#
# NEGATIVE=1 is the control: the same page with no extension. It must not show
# `COLOR`. Its witness is `REFUSED`, which the page paints only after finding
# PublicKeyCredential, asking and being refused. So without an extension a site
# gets a refusal, not a request held on an invisible dialog.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
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

# The color for the fixture's answer. Not overridable:
# `scripts/test-webview-passkey-extension-guard.sh` checks it against the page.
readonly COLOR="5E35B1"
# The shell's background, then the page's colors before an answer, for a
# refusal, for no API and for an unheld conditional get(). Distinct from other
# guards' colors.
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

# 1. The page, from a local server: `crux` cannot reach arbitrary hosts.
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

# The positive run loads the extension. The control does not, and its witness
# is the page's refusal.
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

# 2. The engine. The feature is disabled in both legs, so they differ only in
#    `--load-extension`.
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
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
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

# 3. The probe watches for `COLOR` until it gives up. Under `timeout`, because
#    a probe whose browser died waits for a reply forever. The verdict reads
#    status 124 as that.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  timeout "$((FOR_SECONDS + 30))" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

# Only on a pass: a failed run's time is just the timeout.
if [ "$NEGATIVE" != "1" ] && [ "$STATUS" -eq 0 ]; then
  budget_note webview-passkey-extension "$(($(date +%s) - STARTED_AT))"
fi

MEASURED="$LEG $STATUS"
echo
echo "measured: $MEASURED"
echo "what the page and the fixture said:"
grep -F '"GUARD ' "$ENGINE_LOG" | tail -5 || true

# The verdict. `scripts/test-webview-passkey-extension-guard.sh` runs this
# block directly. The probe exits 0 for the color seen, 1 for the witness only,
# 2 for neither; 124 is `timeout`'s.
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
conditional get() rather than holding it (patch 0084), or its request never \
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
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
