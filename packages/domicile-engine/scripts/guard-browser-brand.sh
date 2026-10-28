#!/usr/bin/env bash
# Checks that the engine tells sites it is Google Chrome, in
# `navigator.userAgentData` and so in `Sec-CH-UA`.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-browser-brand.sh /build/chromium/src
#
# A Chromium build sends `Chromium` and no browser brand. Akamai's bot check
# refuses that on some sites, such as Citi's sign-in, and lets Chrome through.
# Patch 0157 adds `Google Chrome`. Its control is in the same run: the page
# must see `Chromium`, which every build sends.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-browser-brand: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-browser-brand-broker}"
PROFILE="${PROFILE:-/tmp/domicile-browser-brand-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-browser-brand-engine.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-browser-brand: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-browser-brand.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# No early exit when it never comes: the verdict below says why, with the
# engine's log.
for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD brands " "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
MEASURED=$(grep -oE '"GUARD brands [^"]*"' "$ENGINE_LOG" | head -1)

case "$MEASURED" in
'"GUARD brands Chromium,Google Chrome"')
  FAILURE=""
  ;;
"")
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not run the module, or the module was refused"
  ;;
'"GUARD brands Chromium"')
  FAILURE="the engine sends no Google Chrome brand ($MEASURED): patch 0157 is missing, so Akamai refuses sites' sign-ins"
  ;;
*)
  FAILURE="the control failed ($MEASURED): the page does not see the Chromium brand every build sends"
  ;;
esac

echo "page: $MEASURED"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-browser-brand: $FAILURE" "$ENGINE_LOG"
  echo "guard-browser-brand: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: the engine sends the Google Chrome brand, and Chromium"
